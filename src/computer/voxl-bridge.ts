// Bridge a browser websocket to voxl's /ws on loopback.
//
// Same job as RfbBridge, one level up: the browser cannot reach voxl (it is
// bound to 127.0.0.1 and wants a password), and when the page is opened
// through omg.dev every socket arrives over the relay anyway. Serve already
// authenticated this socket, so the bridge adds voxl's password itself; the
// browser never sees it.
//
// Flow control lives HERE, not in the browser. voxl sends a frame only while
// few enough earlier ones are unacknowledged, sized for a LAN round trip, and
// it paces every viewer to the slowest one. Over the relay the browser's acks
// arrived hundreds of milliseconds late (and a phone that backgrounds the tab
// stops acking at all), so voxl sat blocked most of the time and the screen
// moved in bursts for everyone.
//
// So the bridge acks each frame to voxl as soon as it has it. While the
// browser socket is backed up it skips that viewer's video instead of
// queueing it; once the socket drains it asks voxl for a keyframe and resumes
// at the first one, so a slow link shows the current screen, not a backlog,
// and never slows another viewer. The browser's own acks and pongs are
// dropped; voxl's pings are answered here and timed to the browser separately
// so the true round trip shows in the log.

import type { ServerWebSocket } from "bun";
import type { VoxlEndpoint } from "./voxl.ts";

const BIN_VIDEO = 0x01;
/** Above this many bytes queued for the browser, skip its video. */
export const VOXL_BACKPRESSURE_BYTES = 512 * 1024;
/** Resume once the queue is below this. */
export const VOXL_RESUME_BYTES = 128 * 1024;
const RTT_LOG_MS = 30_000;

/** Frame id of a voxl video message, or null for anything else. */
export function voxlVideoFrameId(b: Uint8Array): number | null {
  if (b.length < 16 || b[0] !== BIN_VIDEO) return null;
  return ((b[2] << 24) | (b[3] << 16) | (b[4] << 8) | b[5]) >>> 0;
}

/** Browser -> voxl text the bridge handles itself instead of forwarding. */
export function isBrowserFlowMessage(m: string): boolean {
  return m.startsWith("a,") || m.startsWith("po,");
}

export class VoxlBridge {
  private upstream: WebSocket | null = null;
  private closed = false;
  /** Input that arrived before voxl's socket opened. */
  private pending: (string | Uint8Array)[] = [];
  private lastAcked: number | null = null;
  /** Skipping video: the browser socket is backed up, or waiting for a keyframe after it was. */
  private skipping: "backed-up" | "await-key" | null = null;
  private skipped = 0;
  /** voxl ping stamp -> when the bridge forwarded it to the browser. */
  private pings = new Map<string, number>();
  private rtts: number[] = [];
  private rttTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private ws: ServerWebSocket<unknown>,
    private opts: {
      endpoint: Promise<VoxlEndpoint>;
      onClose?: () => void;
      log?: (line: string) => void;
      /** Overridable for tests. */
      bufferedAmount?: () => number;
    },
  ) {}

  private buffered(): number {
    if (this.opts.bufferedAmount) return this.opts.bufferedAmount();
    try {
      return this.ws.getBufferedAmount();
    } catch {
      return 0;
    }
  }

  async open(): Promise<void> {
    let endpoint: VoxlEndpoint;
    try {
      endpoint = await this.opts.endpoint;
    } catch {
      this.close();
      return;
    }
    if (this.closed) return;
    // Bun's WebSocket accepts request headers; a browser one would not.
    const upstream = new WebSocket(`ws://127.0.0.1:${endpoint.port}/ws`, {
      headers: { authorization: `Bearer ${endpoint.password}` },
    } as unknown as string[]);
    upstream.binaryType = "arraybuffer";
    this.attach(upstream);
  }

  /** Wire an upstream socket. Split out so tests can pass a fake. */
  attach(upstream: Pick<WebSocket, "send" | "close" | "readyState" | "addEventListener">): void {
    this.upstream = upstream as WebSocket;
    upstream.addEventListener("open", () => {
      for (const m of this.pending) upstream.send(m);
      this.pending = [];
    });
    upstream.addEventListener("message", (e: MessageEvent) => this.fromVoxl(e.data));
    upstream.addEventListener("close", () => this.close());
    upstream.addEventListener("error", () => this.close());
    this.rttTimer = setInterval(() => this.logRtt(), RTT_LOG_MS);
  }

  private toVoxl(m: string | Uint8Array): void {
    const up = this.upstream;
    if (!up || up.readyState !== WebSocket.OPEN) return;
    try {
      up.send(m);
    } catch {
      this.close();
    }
  }

  private toBrowser(m: string | Uint8Array): void {
    try {
      this.ws.send(m);
    } catch {
      this.close();
    }
  }

  /** voxl -> browser. */
  fromVoxl(data: unknown): void {
    if (this.closed) return;
    if (typeof data === "string") {
      if (data.startsWith('{"s":') || data.includes('"t":"ping"')) {
        // Answer voxl at once, then time the same ping to the browser.
        const stamp = /"s":(\d+)/.exec(data)?.[1];
        if (stamp) {
          this.toVoxl(`po,${stamp}`);
          this.pings.set(stamp, performance.now());
          if (this.pings.size > 32) this.pings.delete(this.pings.keys().next().value!);
        }
      }
      this.toBrowser(data);
      return;
    }
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : (data as Uint8Array);
    const id = voxlVideoFrameId(bytes);
    if (id === null) {
      this.toBrowser(bytes);
      return;
    }
    // Ack at once: voxl's pace must never wait on the browser's link.
    if (id !== this.lastAcked) {
      this.lastAcked = id;
      this.toVoxl(`a,${id}`);
    }
    const queued = this.buffered();
    if (this.skipping === null && queued > VOXL_BACKPRESSURE_BYTES) this.skipping = "backed-up";
    if (this.skipping === "backed-up") {
      if (queued > VOXL_RESUME_BYTES) {
        this.skipped++;
        return;
      }
      // Drained: the decoder missed frames, so restart it from a keyframe.
      this.skipping = "await-key";
      this.toVoxl("kf");
    }
    if (this.skipping === "await-key") {
      if ((bytes[1] & 1) !== 1) {
        this.skipped++;
        return;
      }
      this.skipping = null;
    }
    this.toBrowser(bytes);
  }

  /** Browser -> voxl. */
  write(message: string | Uint8Array): void {
    if (this.closed) return;
    if (typeof message === "string" && isBrowserFlowMessage(message)) {
      if (message.startsWith("po,")) {
        const sent = this.pings.get(message.slice(3));
        if (sent !== undefined) {
          this.pings.delete(message.slice(3));
          this.rtts.push(performance.now() - sent);
          if (this.rtts.length > 200) this.rtts.shift();
        }
      }
      return;
    }
    const up = this.upstream;
    if (!up || up.readyState !== WebSocket.OPEN) {
      if (this.pending.length < 256) this.pending.push(message);
      return;
    }
    this.toVoxl(message);
  }

  private logRtt(): void {
    if (!this.rtts.length) return;
    const sorted = [...this.rtts].sort((a, b) => a - b);
    const p = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
    this.opts.log?.(`[voxl] browser round trip ms p50=${p(0.5)} p90=${p(0.9)} n=${sorted.length} skipped=${this.skipped}`);
    this.rtts = [];
    this.skipped = 0;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.rttTimer) clearInterval(this.rttTimer);
    this.logRtt();
    try {
      this.upstream?.close();
    } catch {}
    this.upstream = null;
    try {
      this.ws.close();
    } catch {}
    this.opts.onClose?.();
  }
}
