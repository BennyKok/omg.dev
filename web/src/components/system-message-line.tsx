/**
 * A turn the machine wrote, drawn as one quiet line instead of a sent bubble.
 *
 * Same idea as mobile SystemLine: a background task, a fork opener, a continue,
 * a rotation notice, a routine, a peer write-in. Those arrive as role:user
 * text with a marker in front. The bubble put that marker in the person's
 * mouth. These are events, so they read as events: centred, muted, with the
 * body two lines deep and the rest one click away.
 */
import { useState } from "react";
import {
  ArrowUpRight,
  ChevronRight,
  CircleHelp,
  Clock3,
  CornerDownRight,
  FoldVertical,
  GitFork,
  Info,
  LockKeyholeOpen,
  MessagesSquare,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useSessionRefLabel } from "../lib/session-ref-link";
import { openLinkedSession } from "../lib/session-return";
import { MessageResponse } from "./ai-elements/message";
import {
  systemMessageHasPreview,
  systemMessageLinksSession,
  systemMessagePreview,
  type SystemMessage,
  type SystemMessageKind,
} from "../lib/system-message";

const SYSTEM_ICONS: Record<SystemMessageKind, LucideIcon> = {
  "background-task": CornerDownRight,
  subagent: CornerDownRight,
  peer: MessagesSquare,
  "bot-message": MessagesSquare,
  "ask-answer": CircleHelp,
  "browser-login": LockKeyholeOpen,
  fork: GitFork,
  rotation: RotateCw,
  routine: Clock3,
  builder: Info,
  compaction: FoldVertical,
};

/** The small heading over a linked session's name. */
const LINK_EYEBROW: Partial<Record<SystemMessageKind, string>> = {
  "background-task": "Report from",
  fork: "Started from",
  peer: "Message from",
};

const LINK_OPEN_LABEL: Partial<Record<SystemMessageKind, string>> = {
  "background-task": "Open the session that reported",
  fork: "Open the source session",
  peer: "Open the session that wrote",
};

export function SystemMessageLine({
  system,
  raw,
}: {
  system: SystemMessage;
  raw: string;
}) {
  if (systemMessageLinksSession(system)) return <LinkedSessionCard system={system} raw={raw} />;
  return <QuietSystemLine system={system} raw={raw} />;
}

/**
 * A row that names another session: a child's report, a fork's source, a peer
 * write-in. It reads as a card for that session. The name opens it in place
 * (the destination then offers the way back), and the body renders as the
 * agent wrote it, markdown and all, one click below.
 */
function LinkedSessionCard({ system, raw }: { system: SystemMessage; raw: string }) {
  const [open, setOpen] = useState(false);
  const id = system.id!;
  const Icon = SYSTEM_ICONS[system.kind];
  const resolved = useSessionRefLabel(id);
  const name = system.source || resolved?.title || "Untitled session";
  const preview = systemMessagePreview(system.body);
  const body = system.body || raw;
  const openLabel = `${LINK_OPEN_LABEL[system.kind] ?? "Open the session"}, ${id}`;
  const go = () => openLinkedSession(id);
  const bodyId = `sysmsg-body-${id}-${system.kind}`;

  return (
    <div
      data-slot="linked-session-card"
      className="w-[min(40rem,100%)] overflow-hidden rounded-2xl border border-border/70 bg-card/50 text-left shadow-[0_1px_0_0_rgb(0_0_0/0.02)]"
    >
      <div className="flex items-start gap-3 px-3.5 pt-3 pb-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <span>{LINK_EYEBROW[system.kind] ?? "Session"}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono opacity-80">{id}</span>
          </div>
          <button
            type="button"
            onClick={go}
            title={openLabel}
            className="block max-w-full truncate rounded text-left text-sm font-medium leading-5 text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {name}
          </button>
          {!open && preview ? (
            <p className="mt-1 line-clamp-2 text-xs leading-[1.125rem] text-muted-foreground">{preview}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={go}
          aria-label={openLabel}
          title={openLabel}
          className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-border/80 px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </button>
      </div>
      {body ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={`${system.label}, ${id}. ${open ? "Hide" : "Show"} the full message`}
            className="flex w-full items-center gap-1 border-t border-border/60 px-3.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
              aria-hidden="true"
            />
            {open ? "Hide" : "Show full message"}
          </button>
          {open ? (
            <div
              id={bodyId}
              className="max-h-[28rem] overflow-auto border-t border-border/60 px-4 py-3 text-[13px] leading-relaxed"
            >
              <MessageResponse>{body}</MessageResponse>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function QuietSystemLine({ system, raw }: { system: SystemMessage; raw: string }) {
  const [open, setOpen] = useState(false);
  const Icon = SYSTEM_ICONS[system.kind];
  const preview = systemMessageHasPreview(system) ? systemMessagePreview(system.body) : "";
  const body = system.body || raw;

  // A compaction is a boundary in the conversation, not a message: what is
  // above it the agent now holds only as the summary behind this line.
  const divider = system.kind === "compaction";
  return (
    <div className="flex w-full min-w-0 flex-col items-center">
      <div className={cn("flex w-full min-w-0 items-center justify-center", divider && "gap-2")}>
      {divider ? <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-border" /> : null}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${system.label}${system.id ? `, ${system.id}` : ""}. ${open ? "Hide" : "Open"}`}
        className="flex max-w-md flex-col items-center gap-1 px-4 py-1.5 text-center outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex max-w-full items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{system.label}</span>
          {system.id ? (
            <span className="shrink-0 font-mono text-[11px] font-normal opacity-70">{system.id}</span>
          ) : null}
          <ChevronRight
            className={cn("size-2.5 shrink-0 transition-transform", open && "rotate-90")}
            aria-hidden="true"
          />
        </span>
        {!open && preview ? (
          <span className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/70">
            {preview}
          </span>
        ) : null}
      </button>
      {divider ? <span aria-hidden="true" className="h-px min-w-6 flex-1 bg-border" /> : null}
      </div>
      {open ? (
        <div className="mt-0.5 max-h-80 w-[min(42rem,92%)] overflow-auto rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-left text-[13px] leading-relaxed text-muted-foreground">
          <MessageResponse>{body}</MessageResponse>
        </div>
      ) : null}
    </div>
  );
}
