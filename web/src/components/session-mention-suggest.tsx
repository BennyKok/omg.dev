import { useEffect, useRef } from "react";
import { cn } from "../lib/utils";
import {
  sessionFolderName,
  type MentionableSession,
  type SessionMentionState,
} from "../lib/session-mention";

/**
 * The `#` session picker popup. The list and the highlight are owned by the
 * composer field, because the arrow keys land on the textarea.
 */
export function SessionMentionSuggest({
  active,
  matches,
  selected,
  onHover,
  onPick,
}: {
  active: SessionMentionState | null;
  matches: MentionableSession[];
  selected: number;
  onHover: (index: number) => void;
  onPick: (session: MentionableSession) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-session-mention-option="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!active || !matches.length) return null;

  return (
    <div
      data-no-composer-swipe
      data-session-mention-suggest
      onWheel={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
    >
      <div
        ref={listRef}
        className="max-h-[min(18rem,42dvh)] overflow-y-auto overscroll-contain p-1 touch-pan-y"
      >
        {matches.map((session, idx) => {
          const folder = sessionFolderName(session.cwd) || session.project;
          return (
            <button
              key={session.sessionId}
              type="button"
              data-session-mention-option={idx}
              aria-selected={idx === selected}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => onPick(session)}
              onMouseEnter={() => onHover(idx)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
                idx === selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/70",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  session.live ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  <span className="font-mono text-primary">#</span>
                  {session.title || session.sessionId.slice(0, 8)}
                </span>
              </span>
              {folder ? (
                <span
                  className={cn(
                    "shrink-0 truncate rounded px-1.5 py-0.5 font-mono text-[11px]",
                    session.sameFolder
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {folder}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
