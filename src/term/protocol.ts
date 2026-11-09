// Wire protocol between `lfg serve` and the terminal host (src/term/host.ts).
//
// The host is a separate, long-lived process that owns every browser-terminal
// shell. serve talks to it over a unix socket in the data directory, so a serve
// restart (every deploy) drops only the socket, never the shells. This replaced
// the per-terminal tmux sessions the terminal used to attach to.
//
// Framing is deliberately tiny: [kind u8][length u32 BE][payload]. A JSON frame
// carries control; a DATA frame carries raw terminal bytes in either
// direction, so keystrokes and VT output are never re-encoded.
import { join } from "node:path";
import { PATHS } from "../config.ts";

/** Bumped when a frame or message changes shape incompatibly. */
export const TERM_PROTOCOL_VERSION = 1;

export const FRAME_JSON = 1;
export const FRAME_DATA = 2;

/** Largest frame either side accepts. A snapshot is the biggest real frame. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export type Frame =
  | { kind: typeof FRAME_JSON; message: TermMessage }
  | { kind: typeof FRAME_DATA; data: Uint8Array };

/** One shell as the host reports it. */
export interface TermShellInfo {
  id: string;
  cwd: string;
  /** OSC 0/2 title the shell last set, if any. */
  title: string | null;
  /** Foreground program, such as `bash`, `vim` or `claude` (Linux only). */
  program: string | null;
  createdAt: number;
  cols: number;
  rows: number;
  clients: number;
}

// serve → host
export type TermRequest =
  | {
      op: "attach";
      id: string;
      cwd: string;
      cols: number;
      rows: number;
      /** Create the shell when it does not exist. Defaults to true. */
      create?: boolean;
      env?: Record<string, string>;
    }
  | { op: "resize"; cols: number; rows: number }
  | { op: "list"; prefix?: string }
  | { op: "kill"; id: string }
  | { op: "run"; id: string; cwd: string; command: string; interrupt?: boolean }
  | { op: "scan"; id: string; lines?: number }
  | { op: "ping" };

// host → serve
export type TermReply =
  | { op: "attached"; shell: TermShellInfo; created: boolean; version: number }
  | { op: "exit"; id: string; code: number | null }
  | { op: "title"; id: string; title: string }
  | { op: "list"; shells: TermShellInfo[] }
  | { op: "killed"; id: string; existed: boolean }
  | { op: "ran"; id: string; created: boolean }
  | { op: "scan"; id: string; plain: string; escaped: string; width: number }
  | { op: "pong"; version: number; pid: number; shells: number }
  | { op: "error"; message: string };

export type TermMessage = TermRequest | TermReply;

/** The unix socket path. `LFG_TERM_HOST_SOCKET` overrides it (tests). */
export function termHostSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.LFG_TERM_HOST_SOCKET?.trim() || join(PATHS.data, "run", "term-host.sock");
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeFrame(frame: Frame): Uint8Array {
  const payload = frame.kind === FRAME_JSON ? enc.encode(JSON.stringify(frame.message)) : frame.data;
  const out = new Uint8Array(5 + payload.length);
  out[0] = frame.kind;
  new DataView(out.buffer).setUint32(1, payload.length);
  out.set(payload, 5);
  return out;
}

export const jsonFrame = (message: TermMessage) => encodeFrame({ kind: FRAME_JSON, message });
export const dataFrame = (data: Uint8Array) => encodeFrame({ kind: FRAME_DATA, data });

/**
 * Incremental decoder for a byte stream of frames. A stream socket can split
 * or join frames anywhere, so bytes accumulate until a whole frame is present.
 * Throws on a malformed stream; the caller closes that connection.
 */
export class FrameDecoder {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): Frame[] {
    if (this.buf.length === 0) {
      this.buf = chunk.slice();
    } else {
      const next = new Uint8Array(this.buf.length + chunk.length);
      next.set(this.buf);
      next.set(chunk, this.buf.length);
      this.buf = next;
    }
    const frames: Frame[] = [];
    let off = 0;
    while (this.buf.length - off >= 5) {
      const kind = this.buf[off];
      const len = new DataView(this.buf.buffer, this.buf.byteOffset + off + 1, 4).getUint32(0);
      if (kind !== FRAME_JSON && kind !== FRAME_DATA) throw new Error(`bad frame kind ${kind}`);
      if (len > MAX_FRAME_BYTES) throw new Error(`frame too large (${len} bytes)`);
      if (this.buf.length - off - 5 < len) break;
      const payload = this.buf.slice(off + 5, off + 5 + len);
      off += 5 + len;
      if (kind === FRAME_DATA) {
        frames.push({ kind, data: payload });
      } else {
        const message = JSON.parse(dec.decode(payload)) as TermMessage;
        if (!message || typeof message !== "object" || typeof (message as { op?: unknown }).op !== "string") {
          throw new Error("bad control frame");
        }
        frames.push({ kind, message });
      }
    }
    this.buf = off === 0 ? this.buf : this.buf.slice(off);
    return frames;
  }
}

/**
 * Terminal ids are the shell's name in the host. They are also part of the
 * socket path namespace for nothing else, but they reach logs and the UI, so
 * keep them to a predictable charset and length.
 */
export function sanitizeTermId(raw: string | null | undefined): string | null {
  const id = (raw ?? "").trim();
  if (!id || id.length > 96) return null;
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

/** The scope prefix every terminal of one agent session shares. */
export function sessionTermScope(sessionId: string): string | null {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "");
  return safe ? `s-${safe}` : null;
}

/**
 * Map a websocket's query to a shell id.
 *
 * `sessionId=<id>[&tab=<tab>]` is a session's terminal: tab 1 is the bare
 * scope, later tabs append `-<tab>`. `session=<name>` is a free-form global
 * shell (the Terminal page, and the agent login terminals).
 */
export function termIdFromQuery(params: URLSearchParams): string | null {
  const sessionId = params.get("sessionId");
  const tab = params.get("tab");
  if (sessionId) {
    const scope = sessionTermScope(sessionId);
    if (!scope) return null;
    if (!tab) return sanitizeTermId(scope);
    const safeTab = sanitizeTermId(tab);
    return safeTab ? sanitizeTermId(`${scope}-${safeTab}`) : null;
  }
  const name = params.get("session") || "main";
  const base = sanitizeTermId(name);
  if (!base || base.startsWith("s-")) return null;
  if (!tab) return base;
  const safeTab = sanitizeTermId(tab);
  return safeTab ? sanitizeTermId(`${base}-${safeTab}`) : null;
}
