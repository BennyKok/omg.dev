// Whether the transcript follows the newest message, as an explicit state
// machine.
//
// THE HISTORY IS THE ARGUMENT FOR THIS SHAPE. `stick` used to be recomputed
// from a measurement on every scroll event:
//
//     setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 72)
//
// That is sound only while `scrollHeight` is stable. Virtualization made the
// total size move on its own, because a row that mounts replaces its estimate
// with a real height. So the state changed from arithmetic the reader never
// caused, and three separate bugs came out of that one root:
//
//   d595fb3  the glide restarted on every trigger and stuttered
//   73a578b  the reader could not escape the glide
//   af3a8a1  a clamp re-armed the pin, and being pinned then switched off the
//            anchor correction, so every later re-measure moved them again
//
// Each was a patch on a symptom. This is the root: STORE the state, and change
// it only on events a person actually caused.
//
//   pinned --[user gesture that moves away from the bottom]--> free
//   free   --[the user's OWN scroll reaches the bottom]------> pinned
//   free   --[the jump-to-latest button]---------------------> pinned
//
// Nothing else transitions. Not a re-measure, not a clamp, not a prepend, not
// content growing, not a write ChatStream makes itself. A clamp is not a
// gesture, so it cannot pin. A re-measure is not a gesture, so it cannot pin.
// The distance threshold is consulted ONLY to answer "did this reader's own
// scroll reach the bottom", never to decide the state by itself.

/** How close to the bottom still counts as "at the bottom". */
export const STICK_BOTTOM_SLACK_PX = 72;

export type ScrollMode = "pinned" | "free";

export type ScrollEventInput = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /** The offset ChatStream last saw, including offsets it wrote itself. */
  previousScrollTop: number;
  /**
   * Is this scroll attributable to the reader?
   *
   * True only while a real input gesture is driving: wheel, touch, pointer or
   * a scroll key. Momentum after a flick still counts, because the gesture
   * that started it did. ChatStream clears this whenever it writes `scrollTop`
   * itself, so its own events are never attributed to the reader.
   */
  userDriven: boolean;
};

/**
 * The next mode for one scroll event.
 *
 * Pure on purpose. Every transition and, more importantly, every NON-
 * transition is unit-tested without a DOM.
 */
export function nextScrollMode(mode: ScrollMode, input: ScrollEventInput): ScrollMode {
  const { scrollTop, scrollHeight, clientHeight, previousScrollTop, userDriven } = input;
  // A transcript shorter than its viewport is at the top and the bottom at
  // once. There is nothing to be scrolled away from, so following is the only
  // meaningful state.
  if (scrollHeight <= clientHeight) return "pinned";
  // Not the reader: a clamp, a re-measure, a prepend correction, or our own
  // glide. None of these express intent, so none of them may change the mode.
  if (!userDriven) return mode;
  const distance = scrollHeight - scrollTop - clientHeight;
  if (mode === "pinned") {
    return distance >= STICK_BOTTOM_SLACK_PX ? "free" : "pinned";
  }
  // free -> pinned needs the reader to arrive at the bottom under their own
  // power. `scrollTop > previousScrollTop` is belt and braces next to
  // `userDriven`: a clamp only ever moves the offset DOWN, so even a clamp
  // that somehow arrives mid-gesture cannot be mistaken for arriving.
  if (distance >= STICK_BOTTOM_SLACK_PX) return "free";
  return scrollTop > previousScrollTop ? "pinned" : "free";
}

/** The reader asked to go back to the bottom. The one unconditional pin. */
export function pinnedByRequest(): ScrollMode {
  return "pinned";
}
