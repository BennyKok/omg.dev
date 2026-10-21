import { afterEach, beforeEach, expect, test } from "bun:test";
import { window } from "../test-support/render";
import { observeVisibleAnimation } from "./visible-animation";

// Protect against a long offscreen roster keeping the animation clock alive,
// and against motion continuing after the person changes their preference.
const originalObserver = globalThis.IntersectionObserver;
const originalMatchMedia = window.matchMedia;
const originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");
let hidden = false;
let reduced = false;
let visibility: (changes: { target: Element; isIntersecting: boolean }[]) => void;
let preference: (() => void) | undefined;
let observed: Set<Element>;
let observers = 0;
let disconnected = 0;
let disposers: (() => void)[];

beforeEach(() => {
  hidden = reduced = false;
  observers = disconnected = 0;
  observed = new Set();
  disposers = [];
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  window.matchMedia = (() => ({
    get matches() { return reduced; },
    addEventListener: (_: string, callback: () => void) => { preference = callback; },
    removeEventListener: () => { preference = undefined; },
  })) as typeof window.matchMedia;
  globalThis.IntersectionObserver = class {
    constructor(callback: typeof visibility) { observers++; visibility = callback; }
    observe(element: Element) { observed.add(element); }
    unobserve(element: Element) { observed.delete(element); }
    disconnect() { disconnected++; observed.clear(); }
  } as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  globalThis.IntersectionObserver = originalObserver;
  window.matchMedia = originalMatchMedia;
  if (originalHidden) Object.defineProperty(document, "hidden", originalHidden);
  else delete (document as unknown as Record<string, unknown>).hidden;
});

function watch() {
  const element = document.createElement("div");
  const changes: boolean[] = [];
  const dispose = observeVisibleAnimation(element, (active) => changes.push(active));
  disposers.push(dispose);
  return { element, changes, dispose };
}

test("only visible decorations run, using one shared observer", () => {
  const a = watch();
  const b = watch();
  expect(observers).toBe(1);
  expect(a.changes).toEqual([false]);
  expect(b.changes).toEqual([false]);
  visibility([{ target: a.element, isIntersecting: true }]);
  visibility([{ target: a.element, isIntersecting: true }]);
  expect(a.changes).toEqual([false, true]);
  expect(b.changes).toEqual([false]);
  visibility([{ target: a.element, isIntersecting: false }, { target: b.element, isIntersecting: true }]);
  expect(a.changes).toEqual([false, true, false]);
  expect(b.changes).toEqual([false, true]);
});

test("hidden tabs and reduced motion stop and resume only visible decorations", () => {
  const a = watch();
  const b = watch();
  visibility([{ target: a.element, isIntersecting: true }]);
  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  reduced = true;
  preference?.();
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(a.changes).toEqual([false, true, false]);
  reduced = false;
  preference?.();
  expect(a.changes).toEqual([false, true, false, true]);
  expect(b.changes).toEqual([false]);
});

test("unmount releases observers and ignores pending visibility reports", () => {
  const a = watch();
  visibility([{ target: a.element, isIntersecting: true }]);
  a.dispose();
  disposers = [];
  expect(a.changes).toEqual([false, true, false]);
  expect(disconnected).toBe(1);
  expect(preference).toBeUndefined();
  visibility([{ target: a.element, isIntersecting: true }]);
  expect(a.changes).toEqual([false, true, false]);
  watch();
  expect(observers).toBe(2);
});

test("starts static for reduced motion and falls back without IntersectionObserver", () => {
  globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;
  reduced = true;
  const a = watch();
  expect(a.changes).toEqual([false]);
  reduced = false;
  preference?.();
  expect(a.changes).toEqual([false, true]);
});
