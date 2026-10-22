import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Session } from "../App";
import { SessionAgentIcon } from "../lib/session-ui";
import { UNREAD_DOT_CLASS } from "../lib/unread";
import { cn } from "../lib/utils";

/**
 * A parent's subagents, folded behind one row: a stack of up to four agent
 * marks, "N subagents", how many are working, and an unread dot. The same
 * shape as the iOS list (mobile/src/omg/subagent-group.tsx). Every descendant
 * stays reachable, including children spawned by a subagent, as one flat run.
 */
export function SubagentGroup({
  sessions,
  open,
  onToggle,
  unreadCount,
  dense = false,
  compact = false,
  renderItem,
}: {
  /** Every descendant, flattened. */
  sessions: Session[];
  open: boolean;
  onToggle: () => void;
  unreadCount: number;
  /** Desktop rail density. Lines the row up with the parent's title. */
  dense?: boolean;
  /** Compact session rows: one line of text, no agent marks, and the open
   *  run uses the same compact rows, set in under the parent's title. */
  compact?: boolean;
  renderItem: (session: Session) => ReactNode;
}) {
  const working = sessions.filter((session) => session.busy).length;
  const label = `${sessions.length} subagent${sessions.length === 1 ? "" : "s"}`;
  const spoken = `${label}${working ? `, ${working} working` : ""}${unreadCount ? `, ${unreadCount} unread` : ""}`;
  if (compact) {
    // CompactSessionRow's title starts after its padding, status mark and
    // gap: 14+14+12 on the phone row, 12+14+10 on the dense rail.
    return (
      <div className="flex flex-col">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={spoken}
          title={open ? "Hide subagent sessions" : "Show subagent sessions"}
          className={cn(
            "flex min-h-8 items-center gap-2 pb-2 pr-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            dense ? "pl-9" : "pl-10",
          )}
        >
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
            {label}
            {working ? ` · ${working} working` : ""}
          </span>
          {unreadCount ? <span className={UNREAD_DOT_CLASS} aria-hidden="true" /> : null}
          {open ? (
            <ChevronUp className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
          )}
        </button>
        {open ? (
          // Each child's status mark sits under the parent's title.
          <div className={cn("flex flex-col pb-1", dense ? "pl-6" : "pl-[26px]")}>
            {sessions.map((session) => renderItem(session))}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    // The row's text column starts after its padding, mark and gap: 10+32+10
    // on the dense rail, 16+40+12 on the full row (see RailRow).
    <div className={cn("flex flex-col", dense ? "ml-[52px]" : "ml-[68px]")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={spoken}
        title={open ? "Hide subagent sessions" : "Show subagent sessions"}
        className="flex min-h-9 items-center gap-2 rounded-lg pr-2 text-left outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <span className="pointer-events-none flex py-1" aria-hidden="true">
          {sessions.slice(0, 4).map((session, index) => (
            <span
              key={session.sessionId || session.nativeSessionId || session.tmuxName || index}
              className={cn("relative rounded-full bg-background p-0.5", index && "-ml-2")}
              style={{ zIndex: 4 - index }}
            >
              <SessionAgentIcon
                session={session}
                showAccountNumber={false}
                className="size-5 rounded-full"
              />
            </span>
          ))}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-xs text-muted-foreground">{label}</span>
          {working ? (
            <span className="truncate text-[11px] text-muted-foreground/70">{working} working</span>
          ) : null}
        </span>
        {unreadCount ? <span className={UNREAD_DOT_CLASS} aria-hidden="true" /> : null}
        {open ? (
          <ChevronUp className="size-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        )}
      </button>
      {open ? (
        // Pulled back by the row padding so a child mark sits under the stack,
        // as the iOS cards sit under theirs.
        <div className="-ml-2.5 mt-0.5 flex flex-col gap-0.5">
          {sessions.map((session) => renderItem(session))}
        </div>
      ) : null}
    </div>
  );
}
