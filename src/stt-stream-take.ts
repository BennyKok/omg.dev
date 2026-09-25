// One /api/voice/stt-stream take, owned end to end: the upstream realtime
// bridge, the audio this box has already received, and the fallback that
// transcribes that audio when the realtime final does not come.
//
// WHY THE BOX KEEPS THE AUDIO. Every byte of the take already crosses this box
// on its way to the realtime provider. When the realtime final was late or the
// upstream died, the phone used to re-upload the whole recording to
// /api/voice/stt through the hosted relay (a 28 s take is ~900 KB of WAV, sent
// again) and wait for a full batch transcription. Measured 2026-09-25: the
// realtime final lands 118–195 ms after a flush when it comes at all, so the
// re-upload was the slow finish the user felt. Transcribing the copy held here
// removes that second upload.
//
// Segments follow flushes. With the default manual commit strategy the
// provider only commits on a flush, so "audio since the previous flush" is
// exactly the audio the pending final covers. An upstream final that arrives
// with no flush pending (server VAD) also closes the segment, so a later
// fallback never re-transcribes words already delivered.
//
// Protocol additions, both ignored by clients that do not know them:
//   s→c {"type":"finalizing"}  the realtime final is late; the box is
//                              transcribing its own copy. Wait for "final".

import type { SttStreamBridge, SttStreamHandlers } from "./voice-providers.ts";
import { SttTakeTimer } from "./stt-stream-timing.ts";

const SAMPLE_RATE = 16_000;
const BYTES_PER_SEC = SAMPLE_RATE * 2;
/** How long after a flush the realtime final may take before the box stops waiting. */
export const REALTIME_FINAL_GRACE_MS = 1_500;
/** Hard cap on the audio held for one segment: 10 minutes of PCM16 at 16 kHz. */
const MAX_SEGMENT_BYTES = 10 * 60 * BYTES_PER_SEC;

export type SttTakeDeps = {
  send: (frame: object) => void;
  /** Close the client socket. */
  closeClient: () => void;
  openBridge: (handlers: SttStreamHandlers) => SttStreamBridge | null;
  /** Whether `transcribe` can produce text on this machine right now. */
  batchAvailable: () => boolean;
  /** Batch-transcribe a WAV. Resolves to the text, or null on any failure. */
  transcribe: (wav: ArrayBuffer) => Promise<string | null>;
  log: (line: string) => void;
  graceMs?: number;
  now?: () => number;
};

/** A 44-byte RIFF header around 16 kHz mono PCM16. */
export function pcm16ToWav(pcm: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(44 + pcm.byteLength);
  const v = new DataView(out);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, BYTES_PER_SEC, true);
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  new Uint8Array(out, 44).set(pcm);
  return out;
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

type PendingSegment = {
  audio: Uint8Array;
  settled: boolean;
  /** True when the box answered from its own copy, not the realtime provider. */
  byFallback: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

export class SttStreamTake {
  readonly timing: SttTakeTimer;
  private bridge: SttStreamBridge | null = null;
  private upstreamDead = false;
  private closed = false;
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private pending: PendingSegment | null = null;
  private fallbacks = 0;

  constructor(private readonly deps: SttTakeDeps) {
    this.timing = new SttTakeTimer(deps.now);
  }

  /** Opens the upstream. False means no realtime provider: close the client. */
  start(): boolean {
    this.bridge = this.deps.openBridge({
      onPartial: (text) => {
        this.timing.partial();
        this.deps.send({ type: "partial", text });
      },
      onFinal: (text) => this.upstreamFinal(text),
      onClose: () => this.upstreamClosed(),
    });
    return this.bridge != null;
  }

  audio(pcm: Uint8Array): void {
    if (this.closed) return;
    this.timing.audio(pcm.byteLength);
    if (this.bytes + pcm.byteLength <= MAX_SEGMENT_BYTES) {
      // The socket may reuse the buffer for the next frame.
      this.chunks.push(pcm.slice());
      this.bytes += pcm.byteLength;
    }
    if (!this.upstreamDead) this.bridge?.pushPcm(pcm);
  }

  flush(): void {
    if (this.closed) return;
    this.timing.flush();
    const audio = concat(this.chunks, this.bytes);
    this.chunks = [];
    this.bytes = 0;
    const segment: PendingSegment = { audio, settled: false, byFallback: false, timer: null };
    this.pending = segment;
    if (this.upstreamDead) {
      void this.fallback(segment, "upstream closed");
      return;
    }
    segment.timer = setTimeout(() => {
      segment.timer = null;
      if (!segment.settled) void this.fallback(segment, "realtime final late");
    }, this.deps.graceMs ?? REALTIME_FINAL_GRACE_MS);
    this.bridge?.flush();
  }

  /** Client said eof or went away. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    this.bridge?.close();
    this.deps.log(`${this.timing.line()}, fallbacks=${this.fallbacks}`);
  }

  private upstreamFinal(text: string): void {
    const segment = this.pending;
    if (segment && !segment.settled) {
      segment.settled = true;
      if (segment.timer) clearTimeout(segment.timer);
      segment.timer = null;
    } else if (segment?.byFallback) {
      // The box already answered this segment from its own copy. Sending the
      // late realtime final too would duplicate the words.
      this.deps.log("[voice] stt-stream: dropped a realtime final that arrived after the fallback");
      return;
    } else {
      // A final with no flush pending (server VAD): the audio held so far is
      // covered by it, so a later fallback must not transcribe it again.
      this.chunks = [];
      this.bytes = 0;
    }
    this.timing.final();
    this.deps.send({ type: "final", text });
  }

  private upstreamClosed(): void {
    this.upstreamDead = true;
    if (this.closed) return;
    // Keep the client socket open when this box can still finish the take
    // from its own copy; the client then gets its words without a re-upload.
    if (this.deps.batchAvailable()) {
      this.deps.log("[voice] stt-stream: realtime upstream closed; keeping the take for the fallback");
      const segment = this.pending;
      if (segment && !segment.settled) {
        if (segment.timer) clearTimeout(segment.timer);
        segment.timer = null;
        void this.fallback(segment, "upstream closed");
      }
      return;
    }
    this.deps.closeClient();
  }

  private async fallback(segment: PendingSegment, reason: string): Promise<void> {
    if (segment.settled || this.closed) return;
    if (!this.deps.batchAvailable()) {
      this.deps.log(`[voice] stt-stream fallback skipped (${reason}): no batch provider`);
      if (this.upstreamDead) this.deps.closeClient();
      return;
    }
    if (!segment.audio.byteLength) {
      segment.settled = true;
      this.deps.send({ type: "final", text: "" });
      return;
    }
    this.fallbacks++;
    this.deps.send({ type: "finalizing" });
    const started = (this.deps.now ?? (() => performance.now()))();
    const text = await this.deps.transcribe(pcm16ToWav(segment.audio));
    const ms = Math.round((this.deps.now ?? (() => performance.now()))() - started);
    const sec = Math.round((segment.audio.byteLength / BYTES_PER_SEC) * 10) / 10;
    if (segment.settled) return; // the realtime final won the race after all
    segment.settled = true;
    segment.byFallback = true;
    if (text == null) {
      this.deps.log(`[voice] stt-stream fallback (${reason}): ${sec}s of audio failed after ${ms}ms`);
      // No usable text. Close so the client falls back to its own file.
      this.deps.closeClient();
      return;
    }
    this.deps.log(`[voice] stt-stream fallback (${reason}): ${sec}s of audio -> ${text.length} chars in ${ms}ms`);
    this.timing.final();
    this.deps.send({ type: "final", text });
  }
}
