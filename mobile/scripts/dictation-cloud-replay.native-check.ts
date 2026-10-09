import { expect, test } from "bun:test";
import type { OmgTransport } from "@omg-dev/client";
import { replayDictationAudio } from "../src/omg/dictation-cloud-replay";

class Socket {
  readyState = 1;
  sent: unknown[] = [];
  listeners = new Map<string, ((event: { data?: string }) => void)[]>();
  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners.set(type, [...this.listeners.get(type) || [], listener]);
  }
  send(data: unknown) { this.sent.push(data); }
  close() { this.readyState = 3; }
  emit(message: object) { for (const listener of this.listeners.get("message") || []) listener({ data: JSON.stringify(message) }); }
}
test("replay uses the selected transport, original PCM, and committed words", async () => {
  const socket = new Socket();
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
  let path = "";
  const transport = { openSocket: async (value: string) => { path = value; return socket; } } as unknown as OmgTransport;
  const result = replayDictationAudio(transport, chunks, () => false);
  await Promise.resolve();
  expect(path).toBe("/api/voice/stt-stream");
  expect(socket.sent).toEqual([...chunks, JSON.stringify({ type: "flush" })]);
  socket.emit({ type: "partial", text: "unfinished" });
  socket.emit({ type: "final", text: "first" });
  socket.emit({ type: "final", text: "second" });
  expect(await result).toBe("first second");
  expect(socket.readyState).toBe(3);
});
test("cancellation during connection sends no audio", async () => {
  const socket = new Socket(); socket.readyState = 0;
  let cancelled = false;
  const transport = { openSocket: async () => socket } as unknown as OmgTransport;
  const result = replayDictationAudio(transport, [new Uint8Array([1, 2])], () => cancelled);
  await Promise.resolve(); cancelled = true;
  for (const listener of socket.listeners.get("open") || []) listener({});
  expect(await result).toBe(""); expect(socket.sent).toEqual([]);
});
