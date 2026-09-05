// The shared React render harness for `bun test`.
//
// This repository has no @testing-library. It does not need one: happy-dom
// plus react-dom/client and `act` is enough to mount a component and assert on
// what actually reaches the DOM. What it lacked was one place to keep that
// setup, so the two component tests that existed each carried their own copy
// of the same twenty lines, and everything else fell back to asserting against
// component SOURCE TEXT with `toContain`.
//
// That fallback is why this file exists. A source-text assertion cannot tell a
// refactor from a regression: rename a local, lift a listener into a module,
// or delete a file, and the test fails while the behavior is fine. Worse, it
// fails the same way when the behavior is genuinely broken, so the failures
// stop being read. One shipped bug on this repository hid behind exactly that
// (a roster preview that never showed "Working"; the assertion naming the call
// had been red long enough to look like noise).
//
// Reach for this file when you would otherwise write `expect(APP).toContain(...)`.
//
// The DOM globals must be installed BEFORE react-dom is imported, which is why
// callers import this module first and then `await import()` their component.
// A static import would be hoisted above the assignment below and react-dom
// would bind to a window that does not exist yet.

import { Window } from "happy-dom";

const window = new Window({ url: "http://127.0.0.1:5173/" });

Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  // Base UI schedules its open/close transitions on animation frames. Without
  // these, mounting any popup part (menu, dialog, tooltip) throws before it
  // reaches the DOM, so no test could open a menu and the group-label crashes
  // below only ever showed up in production.
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  // React reads this to decide whether `act` is legal. Without it every
  // render logs a warning and async updates are not flushed.
  IS_REACT_ACT_ENVIRONMENT: true,
});

export { window };

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");

export type Mounted = {
  /** The element the component was rendered into. */
  host: HTMLElement;
  /** Render (or re-render) into the same root, wrapped in `act`. */
  render: (ui: React.ReactElement) => void;
  /** Run something that triggers React state, wrapped in `act`. */
  flush: (fn: () => void) => void;
  /** Await pending effects and promises (data loads, image decodes). */
  flushAsync: (fn?: () => void | Promise<void>) => Promise<void>;
  /** Discard the current tree and start a new root in a fresh host, for tests
   *  that assert on what a REMOUNT does (a virtualized row scrolling back). */
  remount: () => void;
  /** Unmount and detach. Safe to call twice. */
  cleanup: () => void;
  text: () => string;
  query: (selector: string) => Element | null;
  queryAll: (selector: string) => Element[];
};

/**
 * Mount a root for one test. Call `cleanup()` in `afterEach`.
 *
 * Deliberately not auto-cleaning on process exit: a leaked root between tests
 * shows up as a confusing cross-test failure, and an explicit afterEach makes
 * the ownership obvious.
 */
export function mount(): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root = createRoot(host);
  let live = true;
  return {
    host,
    render: (ui) => act(() => root.render(ui)),
    flush: (fn) => act(fn),
    flushAsync: async (fn) => {
      await act(async () => {
        await fn?.();
      });
    },
    remount: () => {
      act(() => root.unmount());
      root = createRoot(host);
    },
    cleanup: () => {
      if (!live) return;
      live = false;
      act(() => root.unmount());
      host.remove();
    },
    text: () => host.textContent ?? "",
    query: (selector) => host.querySelector(selector),
    queryAll: (selector) => [...host.querySelectorAll(selector)],
  };
}
