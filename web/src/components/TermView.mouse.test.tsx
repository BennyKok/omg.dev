import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { installMouseReporting, installCopyShortcut } = await import("./TermView");

// A ghostty stand-in that reports tmux-style mouse tracking (SGR, button +
// drag) and exposes a fixed cell grid, so the reporting shim has a target.
function fakeTerm(opts: { tracking: boolean; selection?: string }) {
  const canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400 }),
  });
  const cleared: string[] = [];
  return {
    cleared,
    cols: 80,
    rows: 24,
    renderer: { getCanvas: () => canvas, charWidth: 10, charHeight: 16 },
    hasMouseTracking: () => opts.tracking,
    getMode: (m: number) => opts.tracking && (m === 1000 || m === 1002 || m === 1006),
    hasSelection: () => Boolean(opts.selection),
    getSelection: () => opts.selection ?? "",
    clearSelection: () => { cleared.push(opts.selection ?? ""); },
  };
}

function mouse(type: string, init: MouseEventInit) {
  return new window.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("a plain drag under mouse tracking is forwarded to the pty and consumed", () => {
  const host = document.createElement("div");
  ui.host.appendChild(host);
  const sent: string[] = [];
  const off = installMouseReporting(host, fakeTerm({ tracking: true }) as never, (d) => sent.push(d));
  const down = mouse("mousedown", { button: 0, clientX: 15, clientY: 20 });
  host.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  expect(sent).toEqual(["\x1b[<0;2;2M"]);
  off();
});

test("Shift+drag bypasses mouse tracking so ghostty can select natively", () => {
  const host = document.createElement("div");
  ui.host.appendChild(host);
  const sent: string[] = [];
  const off = installMouseReporting(host, fakeTerm({ tracking: true }) as never, (d) => sent.push(d));
  const down = mouse("mousedown", { button: 0, shiftKey: true, clientX: 15, clientY: 20 });
  host.dispatchEvent(down);
  // Shift released mid-drag: the move and release still stay native.
  const move = mouse("mousemove", { buttons: 1, clientX: 100, clientY: 20 });
  host.dispatchEvent(move);
  const up = mouse("mouseup", { button: 0, clientX: 100, clientY: 20 });
  host.dispatchEvent(up);
  expect(down.defaultPrevented).toBe(false);
  expect(move.defaultPrevented).toBe(false);
  expect(up.defaultPrevented).toBe(false);
  expect(sent).toEqual([]);
  // The next unshifted press is reported again.
  host.dispatchEvent(mouse("mousedown", { button: 0, clientX: 15, clientY: 20 }));
  expect(sent).toEqual(["\x1b[<0;2;2M"]);
  off();
});

test("Ctrl+Shift+C copies the selection and does not reach the pty", async () => {
  const host = document.createElement("div");
  ui.host.appendChild(host);
  const term = fakeTerm({ tracking: true, selection: "hello world" });
  const written: string[] = [];
  const off = installCopyShortcut(host, term, async (t) => { written.push(t); });
  const e = new window.KeyboardEvent("keydown", { key: "C", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true });
  host.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(true);
  expect(written).toEqual(["hello world"]);
  expect(term.cleared).toEqual(["hello world"]);
  off();
});

test("Ctrl+C without a selection is left alone so it still sends SIGINT", () => {
  const host = document.createElement("div");
  ui.host.appendChild(host);
  const written: string[] = [];
  const off = installCopyShortcut(host, fakeTerm({ tracking: true }), async (t) => { written.push(t); });
  const e = new window.KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true, cancelable: true });
  host.dispatchEvent(e);
  expect(e.defaultPrevented).toBe(false);
  expect(written).toEqual([]);
  off();
});
