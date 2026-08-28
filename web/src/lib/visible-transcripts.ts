/**
 * Which sessions have their transcript on screen right now.
 *
 * Read state needed a signal for "the person is looking at this", and the
 * obvious candidate was wrong. `useExpandedIds` answers a different question —
 * which transcripts should stream — and on the wide stage that is decided by
 * the `lfg-collapsed:` key, which the stage WRITES for every column it opens
 * and never clears. So it accumulates: every session ever previewed or pinned
 * stays "expanded" in localStorage across restarts. Keying read state on it
 * marked sessions read that were nowhere on screen; measured on a live box, a
 * cold page load cleared four of them at once.
 *
 * This registry is the honest version. A surface that renders a transcript
 * registers on mount and deregisters on unmount, so closing a column or leaving
 * the session page takes the session out again. Nothing is persisted, because
 * "on screen" is not a preference.
 */

import { useEffect, useState } from "react";

const visible = new Set<string>();
const NO_VISIBLE_TRANSCRIPTS: string[] = [];

export const VISIBLE_TRANSCRIPTS_EVENT = "lfg-visible-transcripts";

/**
 * Feature-checked, not existence-checked.
 *
 * `typeof window !== "undefined"` is not enough in this repository: other test
 * files install a partial `window` global that has no `dispatchEvent`, and this
 * module is imported by the same process. Ask whether the thing can do the job.
 */
function announce(): void {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function" ||
    typeof Event !== "function"
  ) {
    return;
  }
  window.dispatchEvent(new Event(VISIBLE_TRANSCRIPTS_EVENT));
}

export function addVisibleTranscriptSid(sid: string): void {
  if (!sid || visible.has(sid)) return;
  visible.add(sid);
  announce();
}

export function removeVisibleTranscriptSid(sid: string): void {
  if (visible.delete(sid)) announce();
}

/** A stable, sorted snapshot. Sorted so two equal sets compare equal by order. */
export function visibleTranscriptSids(): string[] {
  return [...visible].sort();
}

/**
 * Same contents means same array identity.
 *
 * The snapshot feeds an effect's dependency list. Returning a fresh array for an
 * unchanged set would re-run that effect on every unrelated re-render.
 */
export function nextVisibleTranscripts(previous: string[], next: string[]): string[] {
  return previous.length === next.length && previous.every((id, i) => id === next[i])
    ? previous
    : next;
}

/** Test seam. Never call this from the app: surfaces own their own lifetime. */
export function resetVisibleTranscriptsForTest(): void {
  visible.clear();
}

/**
 * The registry as a React value.
 *
 * Lives here rather than in App.tsx so the subscription can be rendered in a
 * test. `nextVisibleTranscripts` is what lets this feed an effect's dependency
 * list without re-running it on every unrelated render.
 */
export function useVisibleTranscriptSids(active = true): string[] {
  const [sids, setSids] = useState<string[]>(visibleTranscriptSids);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const sync = () => setSids((prev) => nextVisibleTranscripts(prev, visibleTranscriptSids()));
    const syncPageVisibility = () => {
      const next = document.visibilityState !== "hidden";
      setPageVisible(next);
      if (next) sync();
    };
    sync();
    window.addEventListener(VISIBLE_TRANSCRIPTS_EVENT, sync);
    document.addEventListener("visibilitychange", syncPageVisibility);
    return () => {
      window.removeEventListener(VISIBLE_TRANSCRIPTS_EVENT, sync);
      document.removeEventListener("visibilitychange", syncPageVisibility);
    };
  }, []);
  // Live stays mounted after its first visit so transcript and gallery state do
  // not reboot on every page switch. A mounted stage hidden behind Settings is
  // not on screen, and neither is a transcript in a background browser tab.
  return active && pageVisible ? sids : NO_VISIBLE_TRANSCRIPTS;
}
