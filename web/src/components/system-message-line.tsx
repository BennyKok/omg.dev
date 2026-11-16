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
import { agentIconAlt, agentIconSrc } from "../lib/session-ui";
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

/** What the linked session is to this one, for the tooltip. */
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
 * write-in. It is one small pill for that session, with its agent's logo when
 * known. One line, nothing under it: the pill opens the session in place
 * (the destination then offers the way back), and the chevron shows the
 * whole message, rendered as markdown. A long name stops at 20rem.
 */
function LinkedSessionCard({ system, raw }: { system: SystemMessage; raw: string }) {
  const [open, setOpen] = useState(false);
  const id = system.id!;
  const Icon = SYSTEM_ICONS[system.kind];
  const known = useSessionRefLabel(id);
  const name = system.source || known?.title || "Untitled session";
  const agent = known?.agent ?? null;
  const body = system.body || raw;
  const verb = LINK_EYEBROW[system.kind] ?? "Session";
  const openLabel = `${LINK_OPEN_LABEL[system.kind] ?? "Open the session"}, ${id}`;
  const toggle = () => setOpen((value) => !value);

  return (
    <div data-slot="linked-session-card" className="flex w-full min-w-0 flex-col items-center gap-0.5">
      <div className="flex h-7 max-w-[min(32rem,100%)] min-w-0 items-center rounded-full border border-border/70 bg-muted/40 text-xs">
        <button
          type="button"
          onClick={() => openLinkedSession(id)}
          aria-label={openLabel}
          title={[`${verb} ${name} · ${id}`, systemMessagePreview(system.body)].filter(Boolean).join("\n\n")}
          className="flex h-full min-w-0 items-center gap-1.5 rounded-l-full pr-1.5 pl-2 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {agent ? (
            <img src={agentIconSrc(agent)} alt={agentIconAlt(agent)} className="size-3.5 shrink-0" />
          ) : (
            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="min-w-0 max-w-[20rem] truncate font-medium text-foreground">{name}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/80">{id}</span>
          <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
        {body ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-label={`${system.label}, ${id}. ${open ? "Hide" : "Show"} the full message`}
            title={open ? "Hide the message" : "Show the message"}
            className="flex h-full shrink-0 items-center rounded-r-full border-l border-border/60 px-1.5 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-1 max-h-80 w-[min(42rem,92%)] overflow-auto rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-left text-[13px] leading-relaxed">
          <MessageResponse>{body}</MessageResponse>
        </div>
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
