/** Sheet drag ownership over nested scrollers. Pure geometry, no native mocks. */
import { expect, test } from "bun:test";
import { canDragSheet } from "../src/omg/sheet-gesture";

const listAtTop = { offset: 0, horizontal: false };

test("an upward drag over a scroller belongs to the scroller when the sheet cannot grow", () => {
  // Resizable and compact: the sheet grows.
  expect(canDragSheet(0, -20, listAtTop, false)).toBe(true);
  // Fixed height (the agent picker), or already expanded: the list scrolls.
  expect(canDragSheet(0, -20, listAtTop, true)).toBe(false);
  // A downward drag from the top still dismisses.
  expect(canDragSheet(0, 20, listAtTop, true)).toBe(true);
  // The handle has no scroll origin and drags either way.
  expect(canDragSheet(0, -20, null, true)).toBe(true);
});

test("a scrolled or blocked origin never hands the gesture to the sheet", () => {
  expect(canDragSheet(0, 20, { offset: 40, horizontal: false }, false)).toBe(false);
  expect(canDragSheet(0, 20, { ...listAtTop, blocked: true }, false)).toBe(false);
  expect(canDragSheet(30, 20, listAtTop, false)).toBe(false);
});
