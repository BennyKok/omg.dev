import { describe, expect, test } from "bun:test";
import { swipeBackCommits, swipeBackFinishMs, swipeBackIntent, swipeBackOffset } from "./swipe-back";

describe("swipe right to go back", () => {
  test("only a rightward, mostly sideways drag is a back gesture", () => {
    expect(swipeBackIntent(3, 2)).toBe("pending");
    expect(swipeBackIntent(40, 6)).toBe("back");
    // Leftward no longer switches to another session: it is nothing.
    expect(swipeBackIntent(-40, 6)).toBe("none");
    // Scrolling the transcript, and the old swipe up from the composer.
    expect(swipeBackIntent(4, -40)).toBe("none");
    expect(swipeBackIntent(20, 30)).toBe("none");
  });

  test("the page follows the finger and never moves left of its place", () => {
    expect(swipeBackOffset(120)).toBe(120);
    expect(swipeBackOffset(-30)).toBe(0);
  });

  test("a third of the width or a flick closes it; less springs back", () => {
    expect(swipeBackCommits(140, 390, 0.1)).toBe(true);
    expect(swipeBackCommits(100, 390, 0.1)).toBe(false);
    expect(swipeBackCommits(60, 390, 0.8)).toBe(true);
    // A flick that never really moved is a tap, not a back.
    expect(swipeBackCommits(4, 390, 2)).toBe(false);
  });

  test("the rest of the close runs at the speed of a full close", () => {
    expect(swipeBackFinishMs(0, 400, 300)).toBe(300);
    expect(swipeBackFinishMs(200, 400, 300)).toBe(150);
    expect(swipeBackFinishMs(390, 400, 300)).toBe(90);
  });
});
