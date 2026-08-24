// Adapt an OmgSocket to the "raw channel" shape noVNC requires.
//
// noVNC's Websock.attach() checks for eight properties by name -- send, close,
// binaryType, onerror, onmessage, onopen, protocol, readyState -- and drives
// the socket through ON-PROPERTY handlers (`ws.onmessage = ...`), not
// addEventListener. OmgSocket only exposes addEventListener, so passing it
// straight to noVNC throws "Raw channel missing property: onmessage".
//
// We could sidestep this by handing noVNC a URL and letting it open its own
// WebSocket, but that would drop the bearer sub-protocol the hosted transport
// attaches -- the Computer would then work locally and 401 when embedded. This
// adapter keeps one authenticated socket path for every surface.
//
// The property checks read Object.keys(channel) and the prototype's own
// property names, so the handlers must be INSTANCE fields (assigned in the
// constructor) and the rest prototype members (methods and getters).

import type { OmgSocket } from "@omg-dev/client";

export class RfbChannel {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType: BinaryType = "arraybuffer";

  constructor(private socket: OmgSocket) {
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => this.onopen?.());
    socket.addEventListener("message", (event) => this.onmessage?.(event));
    socket.addEventListener("close", (event) => this.onclose?.(event));
    socket.addEventListener("error", () => this.onerror?.());
  }

  get readyState(): number {
    return this.socket.readyState;
  }

  /** noVNC only logs this; our bridge negotiates no RFB sub-protocol. */
  get protocol(): string {
    return "";
  }

  send(data: ArrayBufferLike | ArrayBufferView | string): void {
    this.socket.send(data);
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }
}
