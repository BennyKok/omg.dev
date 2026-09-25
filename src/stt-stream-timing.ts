// Per-take timing for the /api/voice/stt-stream bridge.
//
// Dictation feels slow on the iPhone and the logs could not say why: they only
// recorded that a stream opened. This records the moments that separate the
// candidate causes, measured where the audio lands on this box:
//
//   upload backlog  : audio received vs wall clock since the first frame. PCM16
//                     at 16 kHz is 32,000 bytes per second of speech, so a phone
//                     link that cannot keep up shows as audio seconds falling
//                     behind elapsed seconds.
//   stop to text    : flush (the phone pressed stop, or went quiet) to the next
//                     final sent back. That is the provider plus the return hops.
//
// One log line per take, written on close.

const PCM16_16K_BYTES_PER_SEC = 32_000;

export type SttTakeSummary = {
  audioBytes: number;
  audioSec: number;
  firstAudioAfterOpenMs: number | null;
  streamSec: number | null;
  flushToFinalMs: number | null;
  partials: number;
  finals: number;
  totalMs: number;
};

export class SttTakeTimer {
  private readonly openedAt: number;
  private firstAudioAt: number | null = null;
  private lastAudioAt: number | null = null;
  private flushAt: number | null = null;
  private flushToFinalMs: number | null = null;
  private audioBytes = 0;
  private partials = 0;
  private finals = 0;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.openedAt = now();
  }

  audio(bytes: number): void {
    const t = this.now();
    if (this.firstAudioAt == null) this.firstAudioAt = t;
    this.lastAudioAt = t;
    this.audioBytes += bytes;
  }

  flush(): void {
    this.flushAt = this.now();
  }

  partial(): void {
    this.partials++;
  }

  final(): void {
    this.finals++;
    if (this.flushAt != null && this.flushToFinalMs == null) {
      this.flushToFinalMs = Math.round(this.now() - this.flushAt);
    }
  }

  summary(): SttTakeSummary {
    const t = this.now();
    const round1 = (n: number) => Math.round(n * 10) / 10;
    return {
      audioBytes: this.audioBytes,
      audioSec: round1(this.audioBytes / PCM16_16K_BYTES_PER_SEC),
      firstAudioAfterOpenMs: this.firstAudioAt == null ? null : Math.round(this.firstAudioAt - this.openedAt),
      streamSec:
        this.firstAudioAt == null || this.lastAudioAt == null ? null : round1((this.lastAudioAt - this.firstAudioAt) / 1000),
      flushToFinalMs: this.flushToFinalMs,
      partials: this.partials,
      finals: this.finals,
      totalMs: Math.round(t - this.openedAt),
    };
  }

  line(): string {
    const s = this.summary();
    const ms = (v: number | null) => (v == null ? "-" : `${v}ms`);
    return (
      `[voice] stt-stream take: audio=${s.audioSec}s (${s.audioBytes}B) over ${s.streamSec ?? "-"}s, ` +
      `first-audio=${ms(s.firstAudioAfterOpenMs)}, flush->final=${ms(s.flushToFinalMs)}, ` +
      `partials=${s.partials}, finals=${s.finals}, total=${s.totalMs}ms`
    );
  }
}
