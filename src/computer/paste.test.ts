// computer_paste is two pure parts around a live WebView: the page-side
// clipboard write and the trusted Ctrl+V sequence. The WebView half needs a
// running desktop and stays untested here; these cover the parts that can
// drift silently -- script escaping and the key-event order.

import { afterEach, describe, expect, test } from "bun:test";
import { clipboardWriteScript, pasteKeyEvents } from "./browser.ts";

const NAVIGATOR = Object.getOwnPropertyDescriptor(globalThis, "navigator");

afterEach(() => {
  if (NAVIGATOR) Object.defineProperty(globalThis, "navigator", NAVIGATOR);
});

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText } },
    configurable: true,
  });
}

describe("clipboardWriteScript", () => {
  test("is a single expression, which evaluate requires", () => {
    // WebView.evaluate wraps its argument as `await (<expr>)`; a script with
    // a top-level statement would be a syntax error in the page.
    const script = clipboardWriteScript("hello");
    expect(script.startsWith("(() => {")).toBe(true);
    expect(() => eval(script)).not.toThrow();
  });

  test("writes the exact text and reports success", async () => {
    const seen: string[] = [];
    stubClipboard(async (t) => {
      seen.push(t);
    });
    const text = 'quotes "inside" and\na newline\tand émojis 🎉';
    // eval is the point: the script must survive as real page JS, not just
    // look right as a string.
    expect(await eval(clipboardWriteScript(text))).toBe(true);
    expect(seen).toEqual([text]);
  });

  test("reports false when the page has no clipboard API", async () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    expect(await eval(clipboardWriteScript("x"))).toBe(false);
  });

  test("reports false when the write is rejected", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    expect(await eval(clipboardWriteScript("x"))).toBe(false);
  });
});

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
