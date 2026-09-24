import { expect, test } from "bun:test";
import { connectionRoute, startConnectionPing } from "../src/omg/connection-ping";

class Socket {
  binaryType = "arraybuffer" as const;
  readyState = 1;
  url = "wss://sessions-ca.omgs.app/api/live/ws";
  sent: any[] = [];
  closed = false;
  listeners = new Map<string, Function[]>();
  addEventListener(name: string, fn: Function) { this.listeners.set(name, [...this.listeners.get(name) ?? [], fn]); }
  send(data: unknown) { this.sent.push(JSON.parse(String(data))); }
  close() { this.closed = true; this.emit("close", {}); }
  emit(name: string, value: unknown) { for (const fn of this.listeners.get(name) ?? []) fn(value); }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("measures only the matching round trip and ignores unrelated messages", async () => {
  const socket = new Socket(); const states: any[] = []; let now = 10;
  const stop = startConnectionPing({ openLiveSocket: async () => socket }, s => states.push(s), false, { now: () => now, interval: 1000, timeout: 1000 });
  try {
    await tick();
    socket.emit("message", { data: JSON.stringify({ t: "pong", id: "other" }) });
    expect(states.at(-1).ms).toBeNull();
    now = 52;
    socket.emit("message", { data: JSON.stringify({ t: "pong", id: socket.sent[0].id }) });
    expect(states.at(-1)).toEqual({ route: "Relay · Canada", status: "connected", ms: 42 });
    socket.emit("message", { data: JSON.stringify({ t: "ping" }) });
    expect(socket.sent.at(-1)).toEqual({ t: "pong" });
    socket.emit("close", {});
    expect(states.at(-1).status).toBe("unavailable");
    expect(states.at(-1).ms).toBeNull();
  } finally { stop(); }
});

test("a late socket after leaving Settings is closed without probing", async () => {
  const socket = new Socket(); let resolve!: (s: Socket) => void;
  const stop = startConnectionPing({ openLiveSocket: () => new Promise(r => { resolve = r; }) }, () => {});
  stop(); resolve(socket); await tick();
  expect(socket.closed).toBe(true); expect(socket.sent).toHaveLength(0);
});

test("timeout clears a stale number and retries with a fresh route", async () => {
  const states: any[] = []; const sockets: Socket[] = [];
  const stop = startConnectionPing({ openLiveSocket: async () => { const s = new Socket(); sockets.push(s); return s; } }, s => states.push(s), false, { now: () => 0, interval: 5, timeout: 10 });
  try {
    await new Promise(r => setTimeout(r, 35));
    expect(states.some(s => s.status === "unavailable" && s.ms === null)).toBe(true);
    expect(sockets.length).toBeGreaterThan(1);
    expect(sockets[0].closed).toBe(true);
  } finally { stop(); }
});

test("names known relay locations without exposing a grant URL", () => {
  expect(connectionRoute("wss://sessions.omgs.app/api/live/ws?secret=hidden")).toBe("Relay · Germany");
  expect(connectionRoute("wss://dev-us.tail8c417.ts.net/api/live/ws")).toBe("Direct");
  expect(connectionRoute("wss://sessions.omgs.app", true)).toBe("Cloud computer");
  expect(connectionRoute(undefined)).toBe("Connection");
});
