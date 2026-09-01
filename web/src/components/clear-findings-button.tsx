import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * "Clear all" for the auto-findings feed.
 *
 * Two-step, because this one is bulk and there is no undo in the UI: the feed
 * only ever fetches status:"open", so a cleared finding is gone from view for
 * good. Single dismissals stay one tap. This mirrors the "Dismiss all" control
 * on the shipped page (web/src/views/shipped-page.tsx) rather than inventing a
 * second confirmation idiom for the same kind of action.
 *
 * Exported and in its own file so it can be rendered in a test. The findings
 * rail's other control, AutoTriageButton, is a local function inside App.tsx
 * and therefore cannot be.
 */
export function ClearFindingsButton({
  count,
  busy = false,
  onClear,
  className,
}: {
  count: number;
  busy?: boolean;
  onClear: () => void;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);

  // Never leave a primed destructive button behind when the feed changes under
  // it — the count in the label would be answering for a different set.
  useEffect(() => {
    setConfirming(false);
  }, [count]);

  if (count < 1) return null;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        onClear();
      }}
      onBlur={() => setConfirming(false)}
      title="Dismiss every open finding"
      className={cn(
        "-my-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
        confirming
          ? "bg-destructive/10 text-destructive"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {busy ? "Clearing…" : confirming ? `Clear all ${count}?` : "Clear all"}
    </button>
  );
}
