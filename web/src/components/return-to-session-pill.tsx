/**
 * "Back to <session>" over a transcript that a linked-session card opened.
 *
 * A report, a fork opener or a peer message links to another session. Opening
 * it should not strand the person: this pill names the session they came from
 * and takes them back in one click. It shows only on the session the card
 * opened, and only until they go back or dismiss it.
 */
import { ArrowLeft, X } from "lucide-react";

import { useSessionRefLabel } from "../lib/session-ref-link";
import { clearJump, goBackTo, useReturnTarget } from "../lib/session-return";

export function ReturnToSessionPill({ sid }: { sid: string | null | undefined }) {
  const from = useReturnTarget(sid);
  const label = useSessionRefLabel(from);
  if (!from) return null;
  const name = label?.title || from.slice(0, 8);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-3">
      <div
        data-slot="return-to-session"
        className="pointer-events-auto flex max-w-[min(32rem,100%)] items-center rounded-full border border-border bg-background/95 text-xs shadow-sm backdrop-blur"
      >
        <button
          type="button"
          onClick={() => goBackTo(from)}
          aria-label={`Back to ${name}`}
          className="flex min-w-0 items-center gap-1.5 rounded-l-full py-1.5 pr-2 pl-3 font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="shrink-0 text-muted-foreground">Back to</span>
          <span className="min-w-0 truncate">{name}</span>
        </button>
        <button
          type="button"
          onClick={clearJump}
          aria-label="Dismiss"
          className="flex size-7 shrink-0 items-center justify-center rounded-r-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
