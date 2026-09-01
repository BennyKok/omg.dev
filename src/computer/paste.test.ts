// computer_paste is xclip plus a trusted Ctrl+V. The xclip half needs a live
// X display and stays untested here; these cover the key-event sequence, whose
// details were measured on the real stack and could drift silently.

import { describe, expect, test } from "bun:test";
import { pasteKeyEvents } from "./browser.ts";

describe("pasteKeyEvents", () => {
  test("presses Ctrl, chords V, and releases in keyboard order", () => {
    const events = pasteKeyEvents();
    expect(events.map((e) => [e.type, e.key, e.modifiers])).toEqual([
      ["rawKeyDown", "Control", 2],
      // keyDown, not rawKeyDown: a rawKeyDown letter is dropped unless the X
      // window holds real OS focus, and the paste command never fires.
      ["keyDown", "v", 2],
      ["keyUp", "v", 2],
      ["keyUp", "Control", 0],
    ]);
  });

  test("carries no text field, so the chord cannot insert a stray v", () => {
    for (const event of pasteKeyEvents()) {
      expect(event).not.toHaveProperty("text");
    }
  });
});
