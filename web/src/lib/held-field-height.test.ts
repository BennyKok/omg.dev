import { describe, expect, test } from "bun:test";
import { heldFieldHeight } from "./held-field-height";

describe("the composer field during dictation", () => {
  test("grows with the words but never shrinks while dictation is live", () => {
    let held = 0;
    const heights: number[] = [];
    // One line, two lines, the recognizer revises back to one, then three.
    for (const fitted of [40, 64, 40, 88, 64]) {
      const next = heldFieldHeight(fitted, held, true);
      held = next.held;
      heights.push(next.height);
    }
    expect(heights).toEqual([40, 64, 64, 88, 88]);
  });

  test("fits the final text once dictation ends", () => {
    const live = heldFieldHeight(40, 88, true);
    expect(live.height).toBe(88);
    expect(heldFieldHeight(64, live.held, false)).toEqual({ height: 64, held: 0 });
  });

  test("typing is unaffected", () => {
    expect(heldFieldHeight(40, 0, false).height).toBe(40);
    expect(heldFieldHeight(88, 0, false).height).toBe(88);
  });
});
