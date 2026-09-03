// The Board: every task on this box as a kanban, read-only.
//
// Live shows sessions as a rail you work inside. The Board answers a different
// question — "what is the state of everything?" — so it lays the same sessions
// out in columns by what each one needs from you: a question or a blocker,
// nothing (it is working), a next prompt (it is idle), or nothing at all (it
// shipped). Cards open the session; nothing on this page moves a card, because
// the columns are facts the server reports, not a status you set.
//
// Loaded lazily from App.tsx like the other secondary pages.
import { useEffect, useMemo, useState } from "react";
import { CheckCheck, CircleHelp, Loader2, Moon } from "lucide-react";
import type { Session, ShipPost } from "../App";
import { useAsk } from "../components/ask-center";
import { groupBoard, type BoardCard, type BoardColumn } from "../lib/board-columns";
import { SessionAgentIcon, timeAgo } from "../lib/session-ui";
import { subscribeShippedHead } from "../lib/shipped-feed";
import { cn } from "@/lib/utils";

const COLUMN_STYLE: Record<
  BoardColumn["id"],
  { icon: typeof Loader2; accent: string; count: string; empty: string }
> = {
  "needs-you": {
    icon: CircleHelp,
    accent: "text-warning",
    count: "bg-warning/15 text-warning",
    empty: "Nothing is waiting on you.",
  },
  working: {
    icon: Loader2,
    accent: "text-primary",
    count: "bg-primary/10 text-primary",
    empty: "No agent is working right now.",
  },
  idle: {
    icon: Moon,
    accent: "text-muted-foreground",
    count: "bg-muted text-muted-foreground",
    empty: "No idle sessions.",
  },
  shipped: {
    icon: CheckCheck,
    accent: "text-success",
    count: "bg-success/15 text-success",
    empty: "Nothing shipped yet.",
  },
};

function BoardCardView({
  card,
  onOpen,
}: {
  card: BoardCard;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left shadow-xs transition-colors hover:bg-foreground/[0.03] active:bg-foreground/[0.06]"
    >
      <div className="flex items-start gap-2">
        <SessionAgentIcon
          session={card}
          className="mt-0.5 size-4 shrink-0"
          showAccountNumber={false}
        />
        <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug">
          {card.title}
        </span>
      </div>
      {card.note ? (
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{card.note}</p>
      ) : null}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
        {card.project ? <span className="truncate">{card.project}</span> : null}
        <span className="ml-auto shrink-0">{timeAgo(card.at || null)}</span>
      </div>
    </button>
  );
}

/** The columns, given already-grouped cards. Exported so a test can render it
 *  without the ask queue or the shipped poller behind it. */
export function BoardView({
  columns,
  onOpenSession,
  onOpenShipped,
}: {
  columns: BoardColumn[];
  onOpenSession: (sid: string) => void;
  onOpenShipped: (post: ShipPost) => void;
}) {
  const total = columns.reduce((n, c) => n + c.cards.length, 0);
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-3 pb-4 md:px-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-base font-semibold tracking-tight">Board</h1>
        <span className="text-xs text-muted-foreground">
          {total} {total === 1 ? "card" : "cards"} · read only
        </span>
      </div>
      {/* One layout everywhere: the columns sit in a row and each scrolls on
          its own. On a phone the row scrolls sideways and snaps per column,
          so the board reads the same as on desktop instead of as a long
          stacked list. */}
      <div className="flex min-h-0 flex-1 flex-row snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden pb-2 md:snap-none">
        {columns.map((column) => {
          const style = COLUMN_STYLE[column.id];
          const Icon = style.icon;
          return (
            <section
              key={column.id}
              aria-label={column.label}
              className="flex min-h-0 w-[82vw] max-w-72 shrink-0 snap-start flex-col rounded-2xl bg-muted/40 ring-1 ring-inset ring-border/60 md:w-72"
            >
              <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                <Icon
                  className={cn(
                    "size-4 shrink-0",
                    style.accent,
                    column.id === "working" && column.cards.length ? "animate-spin" : null,
                  )}
                />
                <h2 className="text-sm font-semibold">{column.label}</h2>
                <span
                  className={cn(
                    "ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                    style.count,
                  )}
                >
                  {column.cards.length}
                </span>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {column.cards.length === 0 ? (
                  <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                    {style.empty}
                  </p>
                ) : (
                  column.cards.map((card) => (
                    <BoardCardView
                      key={card.key}
                      card={card}
                      onOpen={() => {
                        if (card.post) onOpenShipped(card.post);
                        else if (card.sessionId) onOpenSession(card.sessionId);
                      }}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default function BoardPage({
  sessions,
  onOpenSession,
  onOpenShipped,
}: {
  /** The live list as the Live page shows it, project and user filters applied. */
  sessions: Session[];
  onOpenSession: (sid: string) => void;
  onOpenShipped: (post: ShipPost) => void;
}) {
  const { questions } = useAsk();
  const [posts, setPosts] = useState<ShipPost[]>([]);
  useEffect(
    () =>
      subscribeShippedHead<ShipPost>((result) => {
        if (result.ok) setPosts(result.posts);
      }),
    [],
  );
  const columns = useMemo(
    () => groupBoard({ sessions, questions, posts }),
    [sessions, questions, posts],
  );
  return (
    <BoardView columns={columns} onOpenSession={onOpenSession} onOpenShipped={onOpenShipped} />
  );
}
