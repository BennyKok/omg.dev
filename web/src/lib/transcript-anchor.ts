// May the anchor-restore correction write `scrollTop` RIGHT NOW?
//
// THE BUG THIS ENCODES. On touch, a programmatic `scrollTop` write cancels an
// in-flight momentum scroll outright — the fling just stops. ChatStream's
// anchor restore is a programmatic write, and virtualization made it fire
// exactly mid-fling: rows mount as the reader travels, `measureElement`
// replaces their estimates, `totalSize` moves, the layout effect runs, and the
// anchor row's `start` has shifted by more than the 0.5px guard. The write
// lands while the fling is still moving, and the fling dies.
//
// Skipping the write there is safe, not a trade: `captureAnchor` re-records
// the anchor from every real scroll event, so the shift the skipped write
// would have corrected is absorbed into the very next event's anchor. There is
// no correction debt to pay later. The correction only matters for a reader
// who is HOLDING STILL while content above them re-measures — and a reader
// holding still raises no scroll events, so the recency test below goes false
// and the correction applies again.
//
// A prepend correction (`requested`) is different and always applies: a page
// of older messages landing above the viewport moves every offset at once,
// and skipping that hold would teleport the reader. The reader who triggered
// it is at the edge of loaded history, where a dead fling is the lesser harm.
//
// Pure on purpose, same as lib/transcript-stick: the decision is unit-tested
// without a DOM, and ChatStream stays the single owner of scroll position.

/**
 * A scroll event younger than this means a gesture or its momentum is still
 * driving the pane. Momentum emits events continuously, so recency is a
 * faithful proxy for "in flight"; near the end of a fling events thin out,
 * but by then the momentum a write would cancel is nearly spent.
 */
export const FLING_EVENT_RECENCY_MS = 160;

export type AnchorHoldInput = {
  /** An explicit prepend correction queued by maybeLoadOlder. */
  requested: boolean;
  /** Same flag lib/transcript-stick consumes: a real gesture owns the pane. */
  userDriven: boolean;
  /** now - (last NON-programmatic scroll event), Infinity if none yet. */
  msSinceUserScroll: number;
};

/**
 * Diagnostic counters, readable from the console as
 * `window.__omgScrollDiag`. This is the evidence the fix is judged by:
 * `deferredMidFling` counts corrections that would have landed during a live
 * fling before this change — each one a momentum kill. `applied` counts the
 * writes that still happen. Counters, not logs, so they cost nothing on the
 * scroll path.
 */
export const anchorHoldDiag = {
  applied: 0,
  deferredMidFling: 0,
};

declare global {
  interface Window {
    __omgScrollDiag?: typeof anchorHoldDiag;
  }
}
if (typeof window !== "undefined") {
  window.__omgScrollDiag = anchorHoldDiag;
}

/** Decide, and count the decision. */
export function shouldApplyAnchorCorrection(input: AnchorHoldInput): boolean {
  const { requested, userDriven, msSinceUserScroll } = input;
  if (requested) {
    anchorHoldDiag.applied += 1;
    return true;
  }
  if (userDriven && msSinceUserScroll < FLING_EVENT_RECENCY_MS) {
    anchorHoldDiag.deferredMidFling += 1;
    return false;
  }
  anchorHoldDiag.applied += 1;
  return true;
}
