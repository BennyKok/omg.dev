// The way into the Files panel.
//
// This used to be a floating pill over the bottom of the transcript, riding the
// same row as the "diffs for review" bar. That put a permanent badge on top of
// the conversation — it covered the last message, forced the transcript to
// reserve bottom padding for every focused session, and made "read a file" look
// like a transient notification rather than one of the session's standing
// actions. It is now a normal button in the session header, next to the ⋮ menu,
// where the rest of the per-session controls live.
//
// The button owns its own open state and the lazy panel import, so any header
// can drop it in without threading state through the transcript.

import { memo, Suspense, useEffect, useState } from "react";
import { FileCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { lazyWithReload } from "@/lib/lazy-with-reload";

// The panel and everything under it (@pierre/trees, @pierre/diffs' editor,
// jsdiff) stay out of the first-paint bundle — this only resolves once a user
// actually opens Files.
const SessionFilesPanel = lazyWithReload(
  "session-files-panel",
  () => import("./SessionFilesPanel"),
);

export const SessionFilesButton = memo(function SessionFilesButton({
  sid,
  className,
}: {
  sid: string | null | undefined;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  // The session sheet swaps sessions in place (swipe / arrow keys). Close the
  // panel rather than silently repointing it at another session's checkout.
  useEffect(() => {
    setOpen(false);
  }, [sid]);

  if (!sid) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Files"
        title="Files"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted",
          className,
        )}
      >
        <FileCode className="size-4" />
      </button>
      {open ? (
        <Suspense fallback={null}>
          <SessionFilesPanel sid={sid} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
});

export default SessionFilesButton;
