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
  ChevronRight,
  CircleHelp,
  Clock3,
  CornerDownRight,
  GitFork,
  LockKeyholeOpen,
  MessagesSquare,
  RotateCw,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";
import {
  systemMessageHasPreview,
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
};

export function SystemMessageLine({
  system,
  raw,
}: {
  system: SystemMessage;
  raw: string;
}) {
  const [open, setOpen] = useState(false);
  const Icon = SYSTEM_ICONS[system.kind];
  const preview = systemMessageHasPreview(system) ? systemMessagePreview(system.body) : "";
  const body = system.body || raw;

  return (
    <div className="flex w-full min-w-0 flex-col items-center">
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
      {open ? (
        <pre className="mt-0.5 max-h-72 w-[min(42rem,92%)] overflow-auto whitespace-pre-wrap rounded-xl border border-border/70 bg-muted/30 p-3 text-left font-mono text-[11px] leading-relaxed text-muted-foreground">
          {body}
        </pre>
      ) : null}
    </div>
  );
}
