import { afterEach, expect, test } from "bun:test";
import { replayCloudTranscription } from "./transcription-cloud-replay";
const originalSocket = globalThis.WebSocket;
const originalLocation = globalThis.location;
class FakeSocket {
  static instance: FakeSocket;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: any[] = [];
  closed = false;
  constructor(public url: string, public protocols?: string[]) { FakeSocket.instance = this; queueMicrotask(() => this.onopen?.()); }
  send(value: any) { this.sent.push(value); if (typeof value === "string") queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "final", text: "Recovered text" }) })); }
  close() { this.closed = true; }
}
afterEach(() => { globalThis.WebSocket = originalSocket; globalThis.location = originalLocation; });
function setup() { globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket; globalThis.location = { protocol: "https:", host: "test.local" } as Location; }
test("replays audio through the hosted broker and closes after the final", async () => {
  setup();
  const text = await replayCloudTranscription(new ArrayBuffer(16000), { url: "wss://broker.test/voice", getToken: async () => "test-token" });
  expect(text).toBe("Recovered text");
  expect(FakeSocket.instance.url).toBe("wss://broker.test/voice");
  expect(FakeSocket.instance.protocols).toEqual(["vibes-bearer.test-token"]);
  expect(FakeSocket.instance.sent.filter(value => value instanceof ArrayBuffer)).toHaveLength(2);
  expect(FakeSocket.instance.closed).toBe(true);
});
test("replays through the current self-hosted endpoint", async () => {
  setup();
  expect(await replayCloudTranscription(new ArrayBuffer(3200))).toBe("Recovered text");
  expect(FakeSocket.instance.url).toBe("wss://test.local/api/voice/stt-stream");
});
test("a missing hosted token never uploads audio", async () => {
  setup();
  await expect(replayCloudTranscription(new ArrayBuffer(10), { url: "wss://broker.test", getToken: async () => null })).rejects.toThrow("login is unavailable");
});
