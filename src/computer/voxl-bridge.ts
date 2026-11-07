// Bridge a browser websocket to voxl's /ws on loopback.
//
// Same job as RfbBridge, one level up: the browser cannot reach voxl (it is
// bound to 127.0.0.1 and wants a password), and when the page is opened
// through omg.dev every socket arrives over the relay anyway. Serve already
// authenticated this socket, so the bridge adds voxl's password itself; the
// browser never sees it. Messages pass through untouched in both directions:
// binary frames are video/cursor/clipboard, text frames are JSON or voxl's
// short input commands.

import type { ServerWebSocket } from "bun";
import type { VoxlEndpoint } from "./voxl.ts";

export class VoxlBridge {
  private upstream: WebSocket | null = null;
  private closed = false;
  /** Input that arrived before voxl's socket opened. */
  private pending: (string | Uint8Array)[] = [];

  constructor(
    private ws: ServerWebSocket<unknown>,
    private opts: { endpoint: Promise<VoxlEndpoint>; onClose?: () => void },
  ) {}

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
    this.upstream = upstream;
    upstream.addEventListener("open", () => {
      for (const m of this.pending) upstream.send(m);
      this.pending = [];
    });
    upstream.addEventListener("message", (e: MessageEvent) => {
      if (this.closed) return;
      try {
        this.ws.send(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer));
      } catch {
        this.close();
      }
    });
    upstream.addEventListener("close", () => this.close());
    upstream.addEventListener("error", () => this.close());
  }

  /** Browser -> voxl. */
  write(message: string | Uint8Array): void {
    if (this.closed) return;
    const up = this.upstream;
    if (!up || up.readyState !== WebSocket.OPEN) {
      if (this.pending.length < 256) this.pending.push(message);
      return;
    }
    try {
      up.send(message);
    } catch {
      this.close();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
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
