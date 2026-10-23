// lfg connect reads local lists when local serve says they changed, not on a
// fixed 4 s timer. These pin the parts that make that safe: the socket answers
// pings and reconnects, bursts collapse into one read, and live status rows
// produce the same lifecycle events the full-list read did.
import { describe, expect, test } from "bun:test";
import { coalescedRunner, openLocalChangeFeed } from "./connect-local-feed.ts";
import { applyLocalStatusRows } from "./commands/connect.ts";

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  listeners = new Map<string, Array<(event: any) => void>>();
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, event: any = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  open() { this.readyState = 1; this.emit("open"); }
  message(frame: unknown) { this.emit("message", { data: JSON.stringify(frame) }); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; this.emit("close"); }
}

describe("openLocalChangeFeed", () => {
  test("routes changed and status frames, answers pings, and reconnects", async () => {
    const sockets: FakeSocket[] = [];
    const seen: string[] = [];
    const feed = openLocalChangeFeed("ws://local/api/live/ws", {
      onLive: (live) => seen.push(`live:${live}`),
      onChanged: (topics) => seen.push(`changed:${topics.join(",")}`),
      onStatus: (rows) => seen.push(`status:${rows.length}`),
    }, { createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s; }, minRetryMs: 5 });
    sockets[0]!.open();
    expect(feed.isLive()).toBe(true);
    sockets[0]!.message({ t: "changed", topics: [] });
    sockets[0]!.message({ t: "changed", topics: ["auto", 7] });
    sockets[0]!.message({ t: "status", rows: [{ sessionId: "a" }] });
    sockets[0]!.message({ t: "ping", id: "p1" });
    expect(sockets[0]!.sent).toEqual([JSON.stringify({ t: "pong", id: "p1" })]);
    sockets[0]!.close();
    expect(feed.isLive()).toBe(false);
    await Bun.sleep(20);
    expect(sockets).toHaveLength(2);
    sockets[1]!.open();
    expect(seen).toEqual(["live:true", "changed:", "changed:auto", "status:1", "live:false", "live:true"]);
    feed.close();
    await Bun.sleep(20);
    expect(sockets).toHaveLength(2);
  });
});

describe("coalescedRunner", () => {
  test("never overlaps and folds a burst into one follow-up read", async () => {
    let runs = 0;
    let release!: () => void;
    const runner = coalescedRunner(() => {
      runs++;
      return new Promise<void>((resolve) => { release = resolve; });
    }, 0);
    runner.request();
    runner.request();
    runner.request();
    expect(runs).toBe(1);
    release();
    await Bun.sleep(5);
    expect(runs).toBe(2);
    release();
    await Bun.sleep(5);
    expect(runs).toBe(2);
  });

  test("waits out the gap since the last read", async () => {
    let runs = 0;
    const runner = coalescedRunner(async () => { runs++; }, 40);
    runner.request();
    await Bun.sleep(5);
    runner.request();
    expect(runs).toBe(1);
    await Bun.sleep(60);
    expect(runs).toBe(2);
    expect(runner.lastRunAt()).toBeGreaterThan(0);
  });
});

describe("applyLocalStatusRows", () => {
  const relay = () => {
    const sent: any[] = [];
    const ws = { readyState: WebSocket.OPEN, send: (data: string) => sent.push(JSON.parse(data)) };
    return { sent, get: () => ws as unknown as WebSocket };
  };
  const stateWith = (rows: Array<Record<string, unknown>>) => ({
    seen: new Map(),
    fleetSignature: null,
    fleetSentAt: 0,
    rows: new Map(rows.map((row) => [row.sessionId as string, { ...row } as any])),
  });

  test("a status row that ends a turn emits session.completed, as the full read did", () => {
    const longAgo = Date.now() - 10 * 60_000;
    const state = stateWith([{ sessionId: "s1", busy: true, status: "ok", title: "Fix it", startedAt: longAgo }]);
    const out = relay();
    expect(applyLocalStatusRows(state, [], out.get, true)).toBe(true);
    expect(out.sent.map((frame) => frame.event)).toEqual(["fleet.status"]);
    expect(applyLocalStatusRows(state, [{ sessionId: "s1", busy: false, status: "ok" }], out.get, true)).toBe(true);
    expect(out.sent.map((frame) => frame.event)).toEqual(["fleet.status", "session.completed", "fleet.status"]);
  });

  test("asks for a full read when a row names an unknown session or no list is held", () => {
    const out = relay();
    expect(applyLocalStatusRows(stateWith([]), [{ sessionId: "new" }], out.get, true)).toBe(false);
    expect(applyLocalStatusRows({ ...stateWith([]), rows: null }, [], out.get, true)).toBe(false);
  });
});
