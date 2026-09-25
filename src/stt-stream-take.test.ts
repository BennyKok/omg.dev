import { expect, test } from "bun:test";
import type { SttStreamHandlers } from "./voice-providers";
import { SttStreamTake, pcm16ToWav } from "./stt-stream-take";

function harness(opts: { batch?: boolean; transcribe?: (wav: ArrayBuffer) => Promise<string | null> } = {}) {
  const sent: Array<{ type: string; text?: string }> = [];
  const logs: string[] = [];
  const wavs: ArrayBuffer[] = [];
  let handlers!: SttStreamHandlers;
  const upstream = { pcm: 0, flushes: 0, closed: false };
  let clientClosed = false;
  const take = new SttStreamTake({
    send: (f) => sent.push(f as { type: string; text?: string }),
    closeClient: () => {
      clientClosed = true;
    },
    openBridge: (h) => {
      handlers = h;
      return {
        pushPcm: (p) => {
          upstream.pcm += p.byteLength;
        },
        flush: () => {
          upstream.flushes++;
        },
        close: () => {
          upstream.closed = true;
        },
      };
    },
    batchAvailable: () => opts.batch ?? true,
    transcribe:
      opts.transcribe ??
      (async (wav) => {
        wavs.push(wav);
        return "from the box copy";
      }),
    log: (l) => logs.push(l),
    graceMs: 20,
  });
  expect(take.start()).toBe(true);
  return { take, sent, logs, wavs, upstream, handlers: () => handlers, clientClosed: () => clientClosed };
}

const pcm = (n: number) => new Uint8Array(n).fill(1);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a realtime final inside the grace window is sent once, with no fallback", async () => {
  const h = harness();
  h.take.audio(pcm(3200));
  h.take.flush();
  h.handlers().onFinal("hello");
  await wait(40);
  expect(h.sent).toEqual([{ type: "final", text: "hello" }]);
  expect(h.wavs).toHaveLength(0);
  expect(h.upstream).toEqual({ pcm: 3200, flushes: 1, closed: false });
});

test("a late realtime final makes the box transcribe its own copy, and the late final is dropped", async () => {
  const h = harness();
  h.take.audio(pcm(3200));
  h.take.audio(pcm(1600));
  h.take.flush();
  await wait(40);
  expect(h.sent).toEqual([{ type: "finalizing" }, { type: "final", text: "from the box copy" }]);
  expect(h.wavs[0]!.byteLength).toBe(44 + 4800);
  h.handlers().onFinal("late realtime text");
  expect(h.sent).toHaveLength(2);
  h.take.close();
  expect(h.logs.at(-1)).toContain("fallbacks=1");
});

test("each fallback covers only the audio since the previous flush", async () => {
  const h = harness();
  h.take.audio(pcm(3200));
  h.take.flush();
  h.handlers().onFinal("first");
  h.take.audio(pcm(640));
  h.take.flush();
  await wait(40);
  expect(h.wavs).toHaveLength(1);
  expect(h.wavs[0]!.byteLength).toBe(44 + 640);
});

test("an upstream that dies keeps the client open and the flush is answered from the copy", async () => {
  const h = harness();
  h.take.audio(pcm(3200));
  h.handlers().onClose?.();
  expect(h.clientClosed()).toBe(false);
  h.take.audio(pcm(3200)); // still captured, no longer forwarded
  expect(h.upstream.pcm).toBe(3200);
  h.take.flush();
  await wait(5);
  expect(h.wavs[0]!.byteLength).toBe(44 + 6400);
  expect(h.sent.at(-1)).toEqual({ type: "final", text: "from the box copy" });
});

test("with no batch provider, a dead upstream closes the client as before", () => {
  const h = harness({ batch: false });
  h.handlers().onClose?.();
  expect(h.clientClosed()).toBe(true);
});

test("a failed fallback closes the client so it can use its own file", async () => {
  const h = harness({ transcribe: async () => null });
  h.take.audio(pcm(3200));
  h.take.flush();
  await wait(40);
  expect(h.sent).toEqual([{ type: "finalizing" }]);
  expect(h.clientClosed()).toBe(true);
});

test("pcm16ToWav writes a 16 kHz mono 16-bit header", () => {
  const wav = new DataView(pcm16ToWav(pcm(10)));
  const tag = (o: number) => String.fromCharCode(...new Uint8Array(wav.buffer, o, 4));
  expect(tag(0)).toBe("RIFF");
  expect(tag(8)).toBe("WAVE");
  expect(wav.getUint32(24, true)).toBe(16000);
  expect(wav.getUint16(22, true)).toBe(1);
  expect(wav.getUint16(34, true)).toBe(16);
  expect(wav.getUint32(40, true)).toBe(10);
});
