import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { installIdleMotionPause } from "./idle-motion";

let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; });

function setup() {
  const win = new Window();
  const doc = win.document as unknown as Document;
  let focused = true;
  (doc as any).hasFocus = () => focused;
  let clock = 0;
  cleanup = installIdleMotionPause(doc, win as unknown as globalThis.Window, { idleMs: 1_000, checkEveryMs: 60_000, now: () => clock });
  const root = doc.documentElement;
  return {
    win, root,
    blur() { focused = false; win.dispatchEvent(new win.Event("blur")); },
    focus() { focused = true; win.dispatchEvent(new win.Event("focus")); },
    advance(ms: number) { clock += ms; },
    tick() { win.dispatchEvent(new win.Event("blur")); },
  };
}

test("an unfocused window pauses only after the idle time", () => {
  const h = setup();
  h.blur();
  expect(h.root.dataset.motion).toBeUndefined();
  h.advance(1_000);
  h.tick();
  expect(h.root.dataset.motion).toBe("paused");
});

test("a focused window never pauses, however long it is idle", () => {
  const h = setup();
  h.advance(10_000);
  h.tick();
  expect(h.root.dataset.motion).toBeUndefined();
});

test("a pointer move or focus resumes at once", () => {
  const h = setup();
  h.blur();
  h.advance(1_000);
  h.tick();
  expect(h.root.dataset.motion).toBe("paused");
  h.win.dispatchEvent(new h.win.Event("pointermove"));
  expect(h.root.dataset.motion).toBeUndefined();
  h.advance(1_000);
  h.tick();
  expect(h.root.dataset.motion).toBe("paused");
  h.focus();
  expect(h.root.dataset.motion).toBeUndefined();
});
