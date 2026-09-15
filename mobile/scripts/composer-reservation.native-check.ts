/**
 * How much room the home list leaves for the composer.
 *
 * Three things hang off this one number: the list's bottom inset, the height
 * of the fade above the composer, and where the findings pill sits. Getting it
 * wrong is never a crash, only a screen that looks broken, so it is pinned
 * here rather than left to a screenshot.
 */
import { expect, test } from "bun:test";
import { composerReservation } from "../src/omg/composer-reservation";

/** MIN_COMPOSER_HEIGHT (76) plus a Face ID phone's home indicator. */
const FLOOR = 76 + 34;

test("an under-measurement cannot uncover a row", () => {
  // The first layout pass can land before the agent and usage pills populate.
  expect(composerReservation(0, FLOOR)).toBe(FLOOR);
  expect(composerReservation(60, FLOOR)).toBe(FLOOR);
});

test("a real composer taller than the floor is used as measured", () => {
  expect(composerReservation(142, FLOOR)).toBe(142);
});

/**
 * THE REGRESSION THIS FILE EXISTS FOR.
 *
 * The reservation used to keep the maximum it had ever seen. The composer has
 * several states that are legitimately tall and temporary -- a multi-line
 * prompt, the "/" skill list, the "#" session list, an attachment strip -- so
 * the first time any of them appeared, the number was stuck there for the life
 * of the screen. On a phone that put the "10 updates" pill in the middle of the
 * list and washed out the bottom card under a fade three times its proper
 * height.
 */
test("a tall transient does not outlive itself", () => {
  const tall = composerReservation(236, FLOOR);
  expect(tall).toBe(236);
  // The prompt was sent, the field is one line again. The reservation follows
  // it back down instead of keeping the tall state for the life of the screen.
  expect(composerReservation(118, FLOOR)).toBe(118);
});

test("a device with no home indicator still gets the floor", () => {
  expect(composerReservation(10, 76)).toBe(76);
});

/**
 * The floor is deliberately a little generous: 76 plus a 34pt home indicator
 * is 110, and a resting one-line composer measures about 102. That costs a few
 * points of unused clearance and is the side to err on, because the other side
 * is a card sitting under the glass.
 */
test("the floor rounds up rather than down", () => {
  expect(composerReservation(102, FLOOR)).toBe(FLOOR);
});
