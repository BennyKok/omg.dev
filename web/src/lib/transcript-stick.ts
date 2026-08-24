// What is allowed to re-arm the transcript pin.
//
// `stick` decides whether ChatStream follows the tail. It used to be
// re-derived on every scroll event from one distance:
//
//     setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 72)
//
// That was sound while `scrollHeight` only changed when a message arrived.
// Virtualizing the transcript (38a0b1a) ended that. Scrolling up mounts rows
// that were only ever estimated, `virtualizer.measureElement` replaces each
// estimate with the real height, and the modelled total moves for a reason
// the reader never asked for.
//
// Measured in Chromium over CDP, on a 400px pane with 4000px of content and
// the reader parked at scrollTop 2000:
//
//     shrink 4000 -> 2600   scrollTop 2000        distance 1600 -> 200   0 scroll events
//     shrink 2600 -> 2450   scrollTop 2000        distance  200 ->  50   0 scroll events
//     shrink 2450 -> 2200   scrollTop 2000 -> 1800 (CLAMPED)  distance 0  1 scroll event
//     grow  above  + hold   scrollTop 2100 -> 2600            distance unchanged  1 scroll event
//
// A shrink that stays below the reader is silent, so it can never move the
// pin. A shrink that passes the reader makes the browser clamp `scrollTop`
// and raise a scroll event that reads, by distance alone, exactly like a
// person arriving at the bottom. The old rule believed it, re-armed the pin,
// and the pin effect then wrote `scrollTop` and held the reader down — with
// no new message anywhere in that sequence.
//
// The distance cannot separate the two cases. The direction can:
//
//   - a clamp only ever moves `scrollTop` DOWN (2000 -> 1800 above),
//   - a re-measure above the reader is corrected by ChatStream itself, which
//     records the offset it wrote, so its own event measures no movement,
//   - a reader travelling back to the bottom is then the only thing left that
//     moves `scrollTop` UP.
//
// So arming asks for an upward move. Disarming still asks only for distance:
// nothing but the reader can push the viewport away from the bottom.

/** How close to the bottom still counts as "at the bottom". */
export const STICK_BOTTOM_SLACK_PX = 72;

export type StickMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /**
   * The offset ChatStream last saw, INCLUDING the offsets it wrote itself.
   * Every direct `scrollTop` write in ChatStream records itself here, so the
   * scroll event that write raises reports no movement and cannot be read as
   * the reader asking to go back to the bottom.
   */
  previousScrollTop: number;
};

/**
 * The next value of `stick` for one scroll event.
 *
 * Call it only for events the reader could have caused. ChatStream already
 * skips its own glide through `programmaticScrollRef`.
 */
export function nextStick(stick: boolean, metrics: StickMetrics): boolean {
  const { scrollTop, scrollHeight, clientHeight, previousScrollTop } = metrics;
  // A transcript that does not overflow sits at the top and at the bottom at
  // the same time. There is nothing to be scrolled away from, so the pin is
  // the only meaningful state — the same reading the backfill path takes.
  if (scrollHeight <= clientHeight) return true;
  const distance = scrollHeight - scrollTop - clientHeight;
  // Only the reader can push the viewport away from the bottom, so leaving is
  // always believed.
  if (distance >= STICK_BOTTOM_SLACK_PX) return false;
  if (stick) return true;
  return scrollTop > previousScrollTop;
}
