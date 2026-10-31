/// <reference lib="dom" />
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

// The bug: inside a chat on omg.dev's phone app, an auto agent's "responded"
// toast floated in the middle of the conversation. The value that lifts host
// toasts came from the Create chat box, which stays mounted under an open chat
// and sits mid-screen on omg.dev's Create page. The value must follow the chat
// box a person can actually see.

const win = new Window({ url: "http://127.0.0.1:5173/", width: 400, height: 800 });
const saved = {
  window: globalThis.window,
  document: globalThis.document,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
};

let tracker: typeof import("./host-toast-clear");
const cleanups: Array<() => void> = [];
// What elementFromPoint reports as drawn on top. null = nothing covers.
let cover: Element | null = null;

beforeAll(async () => {
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  });
  (win.document as unknown as Document).elementFromPoint = (x: number, y: number) => {
    if (cover) return cover;
    // The topmost registered box under the point, like a browser would.
    const hits = [...win.document.querySelectorAll("[data-box]")].reverse() as unknown as HTMLElement[];
    return hits.find((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }) ?? (win.document.body as unknown as Element);
  };
  tracker = await import("./host-toast-clear");
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  win.document.body.innerHTML = "";
  cover = null;
});

afterAll(() => Object.assign(globalThis, saved));

function box(name: string, rect: { top: number; height: number; left?: number; width?: number }): HTMLElement {
  const el = win.document.createElement("form") as unknown as HTMLElement;
  el.setAttribute("data-box", name);
  win.document.body.appendChild(el as never);
  const left = rect.left ?? 0;
  const width = rect.width ?? 400;
  el.getBoundingClientRect = () =>
    ({
      top: rect.top,
      bottom: rect.top + rect.height,
      left,
      right: left + width,
      width,
      height: rect.height,
      x: left,
      y: rect.top,
    }) as DOMRect;
  return el;
}

function track(el: HTMLElement): void {
  const cleanup = tracker.trackHostToastClear(el);
  if (cleanup) cleanups.push(cleanup);
}

const clear = () => win.document.documentElement.style.getPropertyValue("--lfg-host-toast-clear");

describe("host toast clearance", () => {
  test("clears the Create chat box when it is the one on screen", () => {
    track(box("create", { top: 400, height: 136 }));
    expect(clear()).toBe("400px");
  });

  test("an open chat's box wins over the Create box mounted under it", () => {
    // omg.dev's Create page: the chat box sits mid-screen over the tutorials.
    track(box("create", { top: 300, height: 136 }));
    track(box("session", { top: 690, height: 110 }));
    expect(clear()).toBe("110px");
  });

  test("a covered box does not lift toasts", () => {
    track(box("create", { top: 300, height: 136 }));
    cover = win.document.createElement("div") as unknown as Element; // a chat page over it, no box of its own
    tracker.measureHostToastClear();
    expect(clear()).toBe("");
  });

  test("a hidden box (Apps, display:none) does not push toasts off the screen", () => {
    track(box("create", { top: 0, height: 0, width: 0 }));
    expect(clear()).toBe("");
  });

  test("a swipe neighbour off to the side does not count", () => {
    track(box("current", { top: 690, height: 110 }));
    track(box("neighbour", { top: 500, height: 300, left: 400 }));
    expect(clear()).toBe("110px");
  });

  test("closing the chat hands the value back to the Create box, then removes it", () => {
    const create = tracker.trackHostToastClear(box("create", { top: 300, height: 136 }));
    const session = tracker.trackHostToastClear(box("session", { top: 690, height: 110 }));
    expect(clear()).toBe("110px");
    session?.();
    expect(clear()).toBe("500px");
    create?.();
    expect(clear()).toBe("");
  });
});
