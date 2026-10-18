// The web app's live hook now runs on OmgLiveConnection (@omg-dev/client).
// These drive a fake socket through the real web transport seam and check what
// the app reads from the hook. Failures this must catch: a transcript that
// never fills from its snapshot, a live line or queued message that does not
// show, typing or busy lost, status rows or list changes not reaching the app,
// a consumer that stops hearing a session, and a reconnect that loses its
// place (no resumeFromSeq) or keeps the viewer off the socket.
import { afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";
import type { OmgSocket, OmgTransport } from "@omg-dev/client";
const { configureOmgTransport } = await import("./lib/omg-client");
const { useLiveSocket } = await import("./useLiveSocket");

class FakeSocket implements OmgSocket {
  binaryType: BinaryType = "blob";
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  private listeners = new Map<string, Set<(event?: unknown) => void>>();
  send(data: unknown) { this.sent.push(JSON.parse(String(data))); }
  close() { this.readyState = 3; }
  addEventListener(type: string, listener: (event?: never) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (event?: unknown) => void);
    this.listeners.set(type, set);
  }
  private fire(type: string, event?: unknown) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
  open() { this.readyState = 1; this.fire("open"); }
  receive(frame: unknown) { this.fire("message", { data: JSON.stringify(frame) }); }
  drop(code = 1006) { this.readyState = 3; this.fire("close", { code, reason: "" }); }
}

const sockets: FakeSocket[] = [];
const queries: Array<string | undefined> = [];
const transport = {
  fetch: async () => new Response("{}"),
  request: async () => ({}) as never,
  openSocket: async () => new FakeSocket(),
  openLiveSocket: async (query?: string) => { queries.push(query); const socket = new FakeSocket(); sockets.push(socket); return socket; },
} as unknown as OmgTransport;
configureOmgTransport(transport);

let ui: Mounted | null = null;
afterEach(() => { ui?.cleanup(); ui = null; sockets.length = 0; queries.length = 0; });

type Hook = ReturnType<typeof useLiveSocket>;
const sessions = [{ sessionId: "s1", busy: false }];

async function mountHook(extra: { onStatusRows?: (rows: unknown[]) => void; onChanged?: (topics: string[]) => void } = {}) {
  const box: { hook?: Hook } = {};
  function Probe() {
    box.hook = useLiveSocket(sessions, ["s1"], { enabled: true, viewerIdentity: "ada@example.com", ...extra } as never);
    return null;
  }
  ui = mount();
  await ui.flushAsync(async () => { ui!.render(<Probe />); });
  await ui.flushAsync(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return box;
}

const subscribed = (socket: FakeSocket) =>
  socket.sent.filter((frame) => frame.t === "subscribe").flatMap((frame) => frame.channels as Array<Record<string, unknown>>);

test("a shown session fills from its snapshot and live frames, and status and list changes reach the app", async () => {
  const rows: unknown[] = [];
  const topics: string[][] = [];
  const box = await mountHook({ onStatusRows: (r) => rows.push(...r), onChanged: (t) => topics.push(t) });
  const socket = sockets[0]!;
  expect(queries).toEqual(["user=ada%40example.com"]);
  await ui!.flushAsync(async () => { socket.open(); await new Promise((r) => setTimeout(r, 0)); });
  expect(box.hook!.connection.status).toBe("live");
  expect(subscribed(socket)).toEqual(expect.arrayContaining([{ kind: "transcript", key: "s1" }, { kind: "status", key: "*" }]));
  expect(socket.sent.find((frame) => frame.t === "subscribe")).toMatchObject({ workRows: true, deferToolArgs: true });

  await ui!.flushAsync(async () => {
    socket.receive({ t: "snapshot", kind: "transcript", key: "s1", seq: 1, messages: [{ id: "u1", role: "user", kind: "text", text: "hello", ts: 1 }], nextBefore: null });
    socket.receive({ t: "delta", kind: "transcript", key: "s1", seq: 2, delta: { t: "msg", sid: "s1", message: { id: "a1", role: "assistant", kind: "text", text: "hi there", ts: 2 } } });
    socket.receive({ t: "delta", kind: "transcript", key: "s1", seq: 3, delta: { t: "queue", sid: "s1", queue: [{ id: "q1", text: "next please", status: "queued", createdAt: 3, queuedBehindTurn: true }] } });
    socket.receive({ t: "delta", kind: "transcript", key: "s1", seq: 4, delta: { t: "busy", sid: "s1", busy: true } });
    socket.receive({ t: "typing", sid: "s1", ids: ["p1"] });
    socket.receive({ t: "status", rows: [{ sessionId: "s1", title: "renamed" }] });
    socket.receive({ t: "changed", topics: ["pins"] });
  });
  const texts = (box.hook!.messagesBySid.s1 ?? []).map((m) => m.text);
  expect(texts).toEqual(expect.arrayContaining(["hello", "hi there", "next please"]));
  expect(box.hook!.busyBySid.s1).toBe(true);
  expect(box.hook!.typingBySid.s1).toEqual(["p1"]);
  expect(rows).toEqual([{ sessionId: "s1", title: "renamed" }]);
  expect(topics).toEqual([["pins"]]);
});

test("a consumer hears its session, and a reconnect resumes from the last frame", async () => {
  const box = await mountHook();
  await ui!.flushAsync(async () => { sockets[0]!.open(); await new Promise((r) => setTimeout(r, 0)); });
  const heard: unknown[] = [];
  let off: () => void = () => {};
  await ui!.flushAsync(async () => {
    off = box.hook!.subscribeTranscript("s2", (event) => heard.push(event));
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(subscribed(sockets[0]!)).toEqual(expect.arrayContaining([{ kind: "transcript", key: "s2" }]));
  await ui!.flushAsync(async () => {
    sockets[0]!.receive({ t: "delta", kind: "transcript", key: "s1", seq: 7, delta: { t: "busy", sid: "s1", busy: false } });
    sockets[0]!.receive({ t: "delta", kind: "transcript", key: "s2", seq: 1, delta: { t: "msg", sid: "s2", message: { id: "m", role: "assistant", kind: "text", text: "for s2", ts: 1 } } });
  });
  expect(heard).toEqual([{ type: "message", message: expect.objectContaining({ text: "for s2" }) }]);

  await ui!.flushAsync(async () => { sockets[0]!.drop(); await new Promise((r) => setTimeout(r, 0)); });
  expect(box.hook!.connection.status).toBe("reconnecting");
  await ui!.flushAsync(async () => { box.hook!.reconnectNow(); await new Promise((r) => setTimeout(r, 0)); });
  expect(sockets).toHaveLength(2);
  await ui!.flushAsync(async () => { sockets[1]!.open(); await new Promise((r) => setTimeout(r, 0)); });
  expect(subscribed(sockets[1]!)).toEqual(expect.arrayContaining([{ kind: "transcript", key: "s1", resumeFromSeq: 7 }]));
  off();
});
