// A linked machine's session opened from the unified sidebar must not move the
// app: its transcript rides a second live socket to that machine (through this
// box's peer proxy), opened only while that session is shown, while the app's
// own socket stays up for everything else.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";
import type { OmgSocket, OmgTransport } from "@omg-dev/client";
const { configureOmgTransport } = await import("./lib/omg-client");
const { resetSessionRoutingForTest, setSessionOwners } = await import("./lib/session-routing");
const { useLiveSocket } = await import("./useLiveSocket");

class FakeSocket implements OmgSocket {
  binaryType: BinaryType = "blob";
  readyState = 0;
  closed = false;
  sent: Record<string, unknown>[] = [];
  private listeners = new Map<string, Set<(event?: unknown) => void>>();
  constructor(readonly url = "base") {}
  send(data: unknown) { this.sent.push(JSON.parse(String(data))); }
  close() { this.readyState = 3; this.closed = true; }
  addEventListener(type: string, listener: (event?: never) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as (event?: unknown) => void);
    this.listeners.set(type, set);
  }
  private fire(type: string, event?: unknown) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
  open() { this.readyState = 1; this.fire("open"); }
  receive(frame: unknown) { this.fire("message", { data: JSON.stringify(frame) }); }
}

const baseSockets: FakeSocket[] = [];
const remoteSockets: FakeSocket[] = [];
configureOmgTransport({
  fetch: async () => new Response("{}"),
  request: async () => ({}) as never,
  openSocket: async () => new FakeSocket(),
  openLiveSocket: async () => { const socket = new FakeSocket(); baseSockets.push(socket); return socket; },
} as unknown as OmgTransport);

const originalWebSocket = globalThis.WebSocket;
let ui: Mounted | null = null;

const hadLocation = "location" in globalThis;
beforeEach(() => {
  resetSessionRoutingForTest();
  // A browser has a global location; the transport builds the socket URL from it.
  if (!hadLocation) (globalThis as { location?: Location }).location = window.location;
  // The linked machine's transport is the real same-origin one; it opens a
  // browser WebSocket at the proxy path.
  globalThis.WebSocket = function (url: string) {
    const socket = new FakeSocket(url);
    remoteSockets.push(socket);
    return socket;
  } as unknown as typeof WebSocket;
  setSessionOwners([{ sessionId: "r1", machineId: "peer-1" }]);
});

afterEach(() => {
  ui?.cleanup();
  ui = null;
  baseSockets.length = 0;
  remoteSockets.length = 0;
  globalThis.WebSocket = originalWebSocket;
  if (!hadLocation) delete (globalThis as { location?: Location }).location;
  resetSessionRoutingForTest();
});

type Hook = ReturnType<typeof useLiveSocket>;
const sessions = [{ sessionId: "s1", busy: false }, { sessionId: "r1", busy: false }];
const tick = () => new Promise((r) => setTimeout(r, 0));
const subscribedKeys = (socket: FakeSocket) =>
  socket.sent
    .filter((frame) => frame.t === "subscribe")
    .flatMap((frame) => frame.channels as Array<{ kind: string; key: string }>)
    .filter((channel) => channel.kind === "transcript")
    .map((channel) => channel.key);

test("a linked machine's session opens its own socket only while shown, and the app's socket stays up", async () => {
  const box: { hook?: Hook } = {};
  function Probe() {
    box.hook = useLiveSocket(sessions, ["s1"], { enabled: true, viewerIdentity: "ada@example.com" } as never);
    return null;
  }
  ui = mount();
  await ui.flushAsync(async () => { ui!.render(<Probe />); });
  await ui.flushAsync(tick);
  await ui.flushAsync(async () => { baseSockets[0]!.open(); await tick(); });

  // Only the local session is shown: the linked machine costs nothing.
  expect(remoteSockets).toHaveLength(0);
  expect(subscribedKeys(baseSockets[0]!)).toEqual(["s1"]);

  // Open the linked machine's session in place: its chat subscribes.
  let off = () => {};
  await ui.flushAsync(async () => { off = box.hook!.subscribeTranscript("r1", () => {}); await tick(); });
  expect(remoteSockets).toHaveLength(1);
  const remote = remoteSockets[0]!;
  expect(remote.url).toMatch(/^ws:\/\/[^/]+\/api\/peers\/machines\/peer-1\/api\/live\/ws\?user=ada%40example\.com$/);
  await ui.flushAsync(async () => { remote.open(); await tick(); });
  expect(subscribedKeys(remote)).toEqual(["r1"]);
  // The app's own socket never asks for the remote session.
  expect(subscribedKeys(baseSockets[0]!)).not.toContain("r1");
  expect(baseSockets).toHaveLength(1);

  await ui.flushAsync(async () => {
    remote.receive({ t: "snapshot", kind: "transcript", key: "r1", seq: 1, messages: [{ id: "m1", role: "assistant", kind: "text", text: "from the studio", ts: 1 }], nextBefore: null });
    await tick();
  });
  expect(box.hook!.messagesBySid.r1?.map((m) => m.text)).toEqual(["from the studio"]);
  expect(box.hook!.connection.status).toBe("live");

  // Leave it: the remote socket closes, the app's socket stays.
  await ui.flushAsync(async () => { off(); await tick(); });
  expect(remote.closed).toBe(true);
  expect(baseSockets[0]!.closed).toBe(false);
});

test("a linked machine's session kept expanded in the rail does not hold that machine's socket", async () => {
  function Probe() {
    // Both sessions are "expanded" (the desktop rail's persisted choice), and
    // nothing shows r1.
    useLiveSocket(sessions, ["s1", "r1"], { enabled: true, viewerIdentity: "ada@example.com" } as never);
    return null;
  }
  ui = mount();
  await ui.flushAsync(async () => { ui!.render(<Probe />); });
  await ui.flushAsync(tick);
  await ui.flushAsync(async () => { baseSockets[0]!.open(); await tick(); });
  expect(remoteSockets).toHaveLength(0);
  expect(subscribedKeys(baseSockets[0]!)).toEqual(["s1"]);
});
