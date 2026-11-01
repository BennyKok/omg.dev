import { describe, expect, test } from "bun:test";
import { cappedFieldHeight, heldFieldHeight } from "./held-field-height";

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

describe("the composer field line cap", () => {
  // 20px lines with 8px top and bottom padding: three lines is 76px.
  test("grows up to three lines, then stops", () => {
    expect(cappedFieldHeight(36, 20, 16, 3)).toBe(36);
    expect(cappedFieldHeight(76, 20, 16, 3)).toBe(76);
    expect(cappedFieldHeight(196, 20, 16, 3)).toBe(76);
  });

  test("a held dictation height cannot pass the cap", () => {
    let held = 0;
    for (const fitted of [36, 116, 56, 196]) held = heldFieldHeight(cappedFieldHeight(fitted, 20, 16, 3), held, true).held;
    expect(held).toBe(76);
  });

  test("no cap, or an unreadable line height, leaves the height alone", () => {
    expect(cappedFieldHeight(196, 20, 16)).toBe(196);
    expect(cappedFieldHeight(196, Number.NaN, 16, 3)).toBe(196);
  });
});
