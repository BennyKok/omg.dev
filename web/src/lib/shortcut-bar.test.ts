import { describe, expect, test } from "bun:test";
import {
  INITIAL_SHORTCUT_BAR_STATE,
  shortcutBarStep,
  type ShortcutBarSample,
  type ShortcutBarState,
} from "./shortcut-bar";

// Heights measured in Safari on the iPad Pro 13-inch simulator (iOS 26.5):
// the window is 1244px at rest, the bar is 66px and settles at 71px.
const REST = 1244;

function run(samples: Partial<ShortcutBarSample>[], start: ShortcutBarState = INITIAL_SHORTCUT_BAR_STATE) {
  let state = start;
  return samples.map((s) => {
    const result = shortcutBarStep(state, {
      layoutHeight: REST,
      visualCoverPx: 0,
      focused: false,
      terminal: false,
      ...s,
    });
    state = result;
    return result;
  });
}

const known: ShortcutBarState = { active: false, reserve: 66, restHeight: REST };

describe("shortcutBarStep", () => {
  test("a bar that shrinks the visual viewport is seen and learned", () => {
    const [, focused] = run([{}, { focused: true, visualCoverPx: 66 }]);
    expect(focused).toMatchObject({ active: true, reserve: 66, lifted: true });
  });

  test("a bar that shrinks the window itself is seen against the resting height", () => {
    // Safari's second form: innerHeight drops by the bar and the visual
    // viewport with it, so the visual measure alone reads 0.
    const [, focused] = run([{}, { focused: true, layoutHeight: REST - 66 }]);
    expect(focused.coveredPx).toBe(66);
    expect(focused).toMatchObject({ active: true, reserve: 66, lifted: true });
  });

  test("once the bar is known, focus lifts before the bar is measured", () => {
    const [focused] = run([{ focused: true }], known);
    expect(focused).toMatchObject({ active: false, lifted: true });
  });

  test("nothing lifts on focus before any bar has been seen", () => {
    const [focused] = run([{ focused: true }]);
    expect(focused.lifted).toBe(false);
  });

  test("the lift holds through the bar's exit after blur, then drops", () => {
    const [up, tail, gone] = run(
      [
        { focused: true, layoutHeight: REST - 66 },
        { focused: false, layoutHeight: REST - 40 },
        { focused: false, layoutHeight: REST },
      ],
      known,
    );
    expect(up.lifted).toBe(true);
    // Still sliding away: the window is short, so the resting height must
    // not be overwritten with it.
    expect(tail).toMatchObject({ active: true, lifted: true, restHeight: REST });
    expect(gone).toMatchObject({ active: false, lifted: false, restHeight: REST });
  });

  test("the on-screen keyboard is never the bar", () => {
    const [focused] = run([{ focused: true, visualCoverPx: 320 }], known);
    expect(focused).toMatchObject({ active: false, lifted: false, reserve: 66 });
  });

  test("a small cover with nothing focused and no bar before is not the bar", () => {
    // Toolbar jitter, or a stale return from the app switcher.
    const [sample] = run([{ visualCoverPx: 60 }]);
    expect(sample).toMatchObject({ active: false, lifted: false, reserve: 0 });
  });

  test("a rotation with nothing focused resets the resting height", () => {
    const [rotated, focused] = run([{ layoutHeight: 900 }, { focused: true, layoutHeight: 900 - 66 }], known);
    expect(rotated.restHeight).toBe(900);
    expect(focused.coveredPx).toBe(66);
  });

  test("Terminal is left alone", () => {
    const [focused] = run([{ focused: true, visualCoverPx: 66, terminal: true }], known);
    expect(focused).toMatchObject({ active: false, lifted: false });
  });
});
