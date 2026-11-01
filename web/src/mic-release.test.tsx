// A finished dictation take must release the microphone at once.
//
// The mic used to stay open (track disabled, not stopped) for 60 s after each
// take. On iOS a disabled track is still a live capture, so the audio session
// stayed in record mode and the user's music stayed paused for that minute
// (Benny, 2026-11-01). These tests drive the real MicButton through one take
// with fake browser audio, and check the track is stopped when the take ends.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted, window } from "./test-support/render";

type FakeTrack = { enabled: boolean; readyState: "live" | "ended"; stop: () => void };
let tracks: FakeTrack[] = [];
let sockets: FakeSocket[] = [];

function fakeStream() {
  const track: FakeTrack = {
    enabled: true,
    readyState: "live",
    stop() { this.readyState = "ended"; },
  };
  tracks.push(track);
  return { getTracks: () => [track], getAudioTracks: () => [track] };
}

class FakeAudioContext {
  sampleRate = 16000;
  destination = {};
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null }; }
  close() { return Promise.resolve(); }
}

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 1;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() { sockets.push(this); }
  emit(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
  send(data: unknown) {
    // The bridge answers a flush with the committed text.
    if (typeof data === "string" && JSON.parse(data).type === "flush") queueMicrotask(() => this.emit({ type: "final", text: "play the song" }));
  }
  close() { this.readyState = 3; }
}

// Other test files share this process's globals (useLiveSocket owns a real
// WebSocket path), so the fakes live only for the length of each test.
const media = { getUserMedia: async () => fakeStream() };
const patched: Array<[object, string, PropertyDescriptor | undefined]> = [];
function patch(target: object, key: string, value: unknown) {
  patched.push([target, key, Object.getOwnPropertyDescriptor(target, key)]);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
}
function installFakes() {
  // Another file may have swapped in its own window, so patch the current one
  // as well as the harness's.
  const current = globalThis.window as unknown as typeof window;
  for (const nav of new Set([globalThis.navigator, window.navigator, current.navigator])) patch(nav, "mediaDevices", media);
  for (const host of new Set<object>([globalThis, window, current])) {
    patch(host, "AudioContext", FakeAudioContext);
    patch(host, "WebSocket", FakeSocket);
  }
  if (typeof globalThis.location === "undefined") patch(globalThis, "location", window.location);
}
function restoreFakes() {
  for (const [target, key, previous] of patched.reverse()) {
    if (previous) Object.defineProperty(target, key, previous);
    else delete (target as Record<string, unknown>)[key];
  }
  patched.length = 0;
}

const { MicButton } = await import("./App");
const { EmbeddedHostOptionsProvider } = await import("./lib/embedded-host-options");

const hosted = { url: "wss://broker.test/stt", getToken: async () => "token" };
let ui: Mounted;
let sent: string[] = [];

beforeEach(() => {
  installFakes();
  tracks = [];
  sockets = [];
  sent = [];
  ui = mount();
  ui.render(
    <EmbeddedHostOptionsProvider value={{ hostedTranscription: hosted }}>
      <MicButton onText={() => {}} onAutoSubmit={(text) => sent.push(text)} />
    </EmbeddedHostOptionsProvider>,
  );
});
afterEach(() => {
  ui.cleanup();
  restoreFakes();
});

const mic = () => ui.query("button") as HTMLButtonElement;

async function take() {
  await ui.flushAsync(() => mic().click());
  await ui.flushAsync();
  expect(tracks.at(-1)?.readyState).toBe("live");
  await ui.flushAsync(() => sockets.at(-1)!.emit({ type: "partial", text: "play the" }));
  await ui.flushAsync(() => mic().click());
  await ui.flushAsync();
  await ui.flushAsync();
}

test("stopping a take stops the mic track at once, not a minute later", async () => {
  await take();
  expect(sent).toEqual(["play the song"]);
  expect(tracks).toHaveLength(1);
  expect(tracks[0]!.readyState).toBe("ended");
});

test("the next take opens a fresh mic and releases it too", async () => {
  await take();
  await take();
  expect(sent).toEqual(["play the song", "play the song"]);
  expect(tracks.map((track) => track.readyState)).toEqual(["ended", "ended"]);
});

test("cancelling a take with Escape also releases the mic", async () => {
  await ui.flushAsync(() => mic().click());
  await ui.flushAsync();
  expect(tracks[0]!.readyState).toBe("live");
  await ui.flushAsync(() => {
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }) as unknown as Event);
  });
  await ui.flushAsync();
  expect(sent).toEqual([]);
  expect(tracks[0]!.readyState).toBe("ended");
});
