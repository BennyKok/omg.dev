/** One serialized stream per take. Buffer one second of PCM16 between passes. */
export interface VoiceWords { text: string; pending: string }
export interface LocalVoiceStream {
  process(pcm: string): Promise<VoiceWords>;
  stop(): Promise<VoiceWords>;
}
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encode(bytes: Uint8Array) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    out += alphabet[a >> 2]! + alphabet[((a & 3) << 4) | (b >> 4)]!
      + (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : "=")
      + (i + 2 < bytes.length ? alphabet[c & 63] : "=");
  }
  return out;
}
export class LocalDictationStream {
  private queue = Promise.resolve();
  private buffer = new Uint8Array(32_000);
  private used = 0;
  private ended = false;
  private cancelled = false;
  private failure: unknown;
  private committed = "";
  private completion: Promise<string> | null = null;
  constructor(private native: LocalVoiceStream, private onWords: (committed: string, pending: string) => void,
    private onFailure: () => void = () => {}) {}
  private accept(words: VoiceWords) {
    if (this.cancelled) return;
    this.committed = [this.committed, words.text.trim()].filter(Boolean).join(" ");
    this.onWords(this.committed, words.pending.trim());
  }
  private enqueue(bytes: Uint8Array) {
    this.queue = this.queue.then(async () => {
      if (this.cancelled || this.failure) return;
      try { this.accept(await this.native.process(encode(bytes))); }
      catch (error) { this.failure = error; if (!this.cancelled) this.onFailure(); }
    });
  }
  push(bytes: Uint8Array) {
    if (this.ended) return;
    for (let offset = 0; offset < bytes.length;) {
      const count = Math.min(bytes.length - offset, this.buffer.length - this.used);
      this.buffer.set(bytes.subarray(offset, offset + count), this.used);
      this.used += count;
      offset += count;
      if (this.used === this.buffer.length) {
        this.enqueue(this.buffer);
        this.buffer = new Uint8Array(32_000);
        this.used = 0;
      }
    }
  }
  finish(): Promise<string> {
    if (this.completion) return this.completion;
    this.ended = true;
    if (this.used && !this.cancelled) this.enqueue(this.buffer.slice(0, this.used));
    this.used = 0;
    this.completion = this.queue.then(async () => {
      // Always release native state, including after cancellation or inference failure.
      try { this.accept(await this.native.stop()); }
      catch (error) { this.failure ??= error; }
      if (this.cancelled) return "";
      if (this.failure) throw this.failure;
      return this.committed;
    });
    return this.completion;
  }
  cancel() { this.cancelled = true; return this.finish().catch(() => ""); }
}
