// Bridge a browser websocket to the local RFB (VNC) port.
//
// noVNC in the browser speaks the RFB protocol but can only open a websocket,
// while x11vnc only speaks raw TCP. Something has to sit between them. The
// usual answer is `websockify`, which drags in a Python runtime and a second
// process to supervise; this is the same job in about fifty lines on top of
// Bun.connect, so the Computer adds no new runtime dependency at all.
//
// The bridge is byte-transparent in both directions -- it never parses RFB. All
// framing, encodings, and input events are noVNC's business and x11vnc's; we
// only move bytes and make sure both halves die together.

import type { ServerWebSocket } from "bun";

export interface RfbBridgeOptions {
  port: number;
  host?: string;
  onClose?: () => void;
}

export class RfbBridge {
  private socket: Awaited<ReturnType<typeof Bun.connect>> | null = null;
  private closed = false;
  /** Bytes that arrived from the browser before the TCP socket finished opening. */
  private pending: Uint8Array[] = [];

  constructor(
    private ws: ServerWebSocket<unknown>,
    private opts: RfbBridgeOptions,
  ) {}

  async open(): Promise<void> {
    const self = this;
    try {
      this.socket = await Bun.connect({
        hostname: this.opts.host ?? "127.0.0.1",
        port: this.opts.port,
        socket: {
          data(_s, chunk) {
            if (self.closed) return;
            try {
              self.ws.send(chunk);
            } catch {
              self.close();
            }
          },
          close() {
            self.close();
          },
          error() {
            self.close();
          },
        },
      });
      // Flush anything the client sent during the connect handshake. RFB starts
      // with the server's version string, so this is usually empty -- but a
      // fast client can still beat us here, and dropping those bytes would
      // wedge the handshake rather than fail it loudly.
      for (const chunk of this.pending) this.socket.write(chunk);
      this.pending = [];
    } catch {
      this.close();
    }
  }

  /** Browser -> X server. */
  write(data: Uint8Array): void {
    if (this.closed) return;
    if (!this.socket) {
      this.pending.push(data);
      return;
    }
    try {
      this.socket.write(data);
    } catch {
      this.close();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket?.end();
    } catch {}
    this.socket = null;
    try {
      this.ws.close();
    } catch {}
    this.opts.onClose?.();
  }
}
