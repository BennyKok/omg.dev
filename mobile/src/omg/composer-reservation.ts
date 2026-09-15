/**
 * How much room the list, the fade and the findings pill leave for the
 * composer, from one measurement of it.
 *
 * ── It has to be allowed to come back down ────────────────────────────────
 *
 * This was `Math.max(current, measured)` — grow only, never shrink. The
 * reasoning was sound and the failure it prevented was real (see the comment
 * at the onLayout below), but the composer has several states that are
 * legitimately TALL and temporary: a multi-line prompt on its way to being
 * sent, the "/" skill list, the "#" session list, an attachment strip. A
 * monotonic maximum means the first time any of those appears, the reservation
 * is stuck at that height for as long as the screen lives.
 *
 * Reported from a phone: the "10 updates" pill floating in the middle of the
 * list instead of just above the field, and the bottom card washed out under a
 * fade roughly three times its proper height. Both hang off this number, and
 * it had been left at about 236pt behind a one-line composer of about 102.
 *
 * ── What the floor is for ─────────────────────────────────────────────────
 *
 * The original worry was an early measurement landing SHORT, before the agent
 * and usage pills populate, and a row ending up under the glass. That is what
 * the floor answers, and it is the same conservative value the state is seeded
 * with — so an under-measurement cannot uncover a row, and an over-measurement
 * no longer outlives the thing that caused it.
 */
export function composerReservation(measured: number, floor: number): number {
  return Math.max(floor, measured);
}
