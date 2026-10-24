// Swipe right on an open chat to go back to the page under it, the way a
// pushed page closes on iOS. The page follows the finger; letting go past a
// third of the width, or with a quick flick to the right, closes it, and
// anything less springs it back.
//
// This replaced two gestures on the phone chat: a sideways swipe that switched
// to the previous or next session, and a swipe up from the composer that
// closed the chat. One direction now means one thing.

/** Movement before the gesture decides it is a drag, in px. */
export const SWIPE_BACK_SLOP_PX = 8;
/** Share of the page width past which a release closes the page. */
export const SWIPE_BACK_COMMIT_RATIO = 1 / 3;
/** A rightward flick this fast (px/ms) closes the page from any distance past the slop. */
export const SWIPE_BACK_FLICK_PX_PER_MS = 0.5;

export type SwipeBackIntent = "pending" | "back" | "none";

/**
 * What a drag is, from its travel so far. Only a mostly horizontal drag to
 * the right is a back gesture; anything else is the scroller's, for the rest
 * of the touch.
 */
export function swipeBackIntent(dx: number, dy: number): SwipeBackIntent {
  if (Math.abs(dx) < SWIPE_BACK_SLOP_PX && Math.abs(dy) < SWIPE_BACK_SLOP_PX) return "pending";
  return dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2 ? "back" : "none";
}

/** Where the page sits under the finger: never left of its resting place. */
export function swipeBackOffset(dx: number): number {
  return Math.max(0, dx);
}

/** Whether letting go closes the page. `velocity` is px/ms, positive to the right. */
export function swipeBackCommits(dx: number, width: number, velocity: number): boolean {
  if (dx <= SWIPE_BACK_SLOP_PX) return false;
  return dx >= width * SWIPE_BACK_COMMIT_RATIO || velocity >= SWIPE_BACK_FLICK_PX_PER_MS;
}

/** How long the page takes to finish leaving from `dx`, so the speed matches a full close. */
export function swipeBackFinishMs(dx: number, width: number, fullMs: number): number {
  const left = width > 0 ? Math.max(0, Math.min(1, 1 - dx / width)) : 1;
  return Math.max(90, Math.round(fullMs * left));
}
