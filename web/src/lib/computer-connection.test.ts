import { beforeEach, expect, test } from "bun:test";
import "../test-support/render";
import type RFB from "@novnc/novnc";
import { createComputerConnection, type ComputerConnection } from "./computer-connection";

class FakeRfb {
  viewOnly = false;
  closed = false;
  private listeners = new Map<string, Array<() => void>>();
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  disconnect() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.listeners.get("disconnect") ?? []) fn();
  }
  focus() {}
}

let opened: FakeRfb[];
let timers: Map<number, () => void>;
let nextTimer: number;
let generation: number;
let pendingOpen: ((rfb: FakeRfb) => void) | null;
let deferOpen: boolean;
let conn: ComputerConnection;
let moves: HTMLElement[];

const runTimers = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
const slot = () => { const el = document.createElement("div"); document.body.appendChild(el); return el; };
const live = () => conn.getSnapshot().rfb as unknown as FakeRfb | null;

beforeEach(() => {
  moves = [];
  opened = []; timers = new Map(); nextTimer = 1; generation = 0; pendingOpen = null; deferOpen = false;
  conn = createComputerConnection({
    open: async () => {
      const rfb = new FakeRfb();
      opened.push(rfb);
      if (deferOpen) await new Promise<void>((resolve) => { pendingOpen = () => resolve(); });
      return rfb as unknown as RFB;
    },
    generation: () => generation,
    createHost: () => { const el = document.createElement("div"); el.dataset.host = "1"; return el; },
    setTimer: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
    moved: (host) => { moves.push(host); },
  });
});

test("moving from inline to full screen keeps the same connection", async () => {
  const inline = slot();
  const releaseInline = conn.hold(inline);
  await conn.connect();
  const first = live();
  expect(inline.querySelector("[data-host]")).not.toBeNull();

  // One React commit: the inline view lets go, the full view takes it.
  releaseInline();
  const full = slot();
  const releaseFull = conn.hold(full);
  await conn.connect();
  runTimers();

  expect(opened.length).toBe(1);
  expect(live()).toBe(first);
  expect(first!.closed).toBe(false);
  expect(full.querySelector("[data-host]")).not.toBeNull();
  releaseFull();
});

test("the picture returns to the older view when the newer one lets go", async () => {
  const a = slot(), b = slot();
  conn.hold(a);
  await conn.connect();
  const releaseB = conn.hold(b);
  expect(b.querySelector("[data-host]")).not.toBeNull();
  releaseB();
  expect(a.querySelector("[data-host]")).not.toBeNull();
  expect(timers.size).toBe(0);
});

test("no view: closes only after the grace period", async () => {
  const release = conn.hold(slot());
  await conn.connect();
  const rfb = live()!;
  release();
  expect(rfb.closed).toBe(false);
  expect(timers.size).toBe(1);
  runTimers();
  expect(rfb.closed).toBe(true);
  expect(conn.getSnapshot()).toMatchObject({ rfb: null, phase: "idle" });
});

test("a view that comes back within the grace period reuses the connection", async () => {
  const release = conn.hold(slot());
  await conn.connect();
  const rfb = live()!;
  release();
  const again = conn.hold(slot());
  await conn.connect();
  runTimers();
  expect(live()).toBe(rfb);
  expect(opened.length).toBe(1);
  again();
});

test("a connect still in flight when the grace period ends is dropped", async () => {
  deferOpen = true;
  const release = conn.hold(slot());
  const pending = conn.connect();
  expect(conn.getSnapshot().phase).toBe("connecting");
  release();
  runTimers();
  pendingOpen!(new FakeRfb());
  await pending;
  expect(opened[0]!.closed).toBe(true);
  expect(conn.getSnapshot().rfb).toBeNull();
});

test("a server-side drop clears the connection so the next connect opens a new one", async () => {
  conn.hold(slot());
  await conn.connect();
  live()!.disconnect();
  expect(conn.getSnapshot().rfb).toBeNull();
  await conn.connect();
  expect(opened.length).toBe(2);
});

test("a different Computer gets a fresh connection", async () => {
  conn.hold(slot());
  await conn.connect();
  const old = live()!;
  generation = 1;
  await conn.connect();
  expect(old.closed).toBe(true);
  expect(opened.length).toBe(2);
});

test("watch-only is shared and applied to a new connection", async () => {
  conn.setViewOnly(true);
  conn.hold(slot());
  await conn.connect();
  expect(live()!.viewOnly).toBe(true);
  conn.setViewOnly(false);
  expect(live()!.viewOnly).toBe(false);
});

test("closing full screen tells the client the picture moved, so a stale cursor can hide", async () => {
  const inline = slot();
  const releaseInline = conn.hold(inline);
  await conn.connect();
  expect(moves).toHaveLength(0);

  // Open full screen: inline lets go, full takes it.
  releaseInline();
  const releaseFull = conn.hold(slot());
  expect(moves.length).toBeGreaterThan(0);

  // Close full screen: the picture leaves the full view, then inline takes it.
  moves = [];
  releaseFull();
  expect(moves).toHaveLength(1);
  conn.hold(inline);
  expect(inline.querySelector("[data-host]")).not.toBeNull();

  // Re-holding the slot it is already in is not a move.
  moves = [];
  conn.hold(inline);
  expect(moves).toHaveLength(0);
});
