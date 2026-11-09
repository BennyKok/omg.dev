// serve's side of the terminal host: start it when it is not running, ask it
// questions, and bridge a browser websocket to one shell.
import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Socket } from "bun";
import {
  FRAME_DATA,
  FrameDecoder,
  TERM_PROTOCOL_VERSION,
  dataFrame,
  jsonFrame,
  termHostSocketPath,
  type TermReply,
  type TermRequest,
  type TermShellInfo,
} from "./protocol.ts";

const HOST_MAIN = join(import.meta.dir, "host-main.ts");

type ConnState = {
  decoder: FrameDecoder;
  pending: Uint8Array[];
  onData: (d: Uint8Array) => void;
  onMessage: (m: TermReply) => void;
  onClose: () => void;
};

function connectOnce(path: string, handlers: Omit<ConnState, "decoder" | "pending">): Promise<Socket<ConnState>> {
  return Bun.connect<ConnState>({
    unix: path,
    data: { ...handlers, decoder: new FrameDecoder(), pending: [] },
    socket: {
      data(sock, chunk) {
        let frames;
        try {
          frames = sock.data.decoder.push(new Uint8Array(chunk));
        } catch {
          sock.end();
          return;
        }
        for (const f of frames) {
          if (f.kind === FRAME_DATA) sock.data.onData(f.data);
          else sock.data.onMessage(f.message as TermReply);
        }
      },
      drain(sock) {
        const q = sock.data.pending;
        while (q.length) {
          const n = sock.write(q[0]);
          if (n < q[0].length) {
            q[0] = q[0].subarray(Math.max(0, n));
            return;
          }
          q.shift();
        }
      },
      close(sock) {
        sock.data.onClose();
      },
      error() {},
    },
  });
}

function send(sock: Socket<ConnState>, bytes: Uint8Array) {
  const q = sock.data.pending;
  if (q.length) {
    q.push(bytes);
    return;
  }
  const n = sock.write(bytes);
  if (n < bytes.length) q.push(bytes.subarray(Math.max(0, n)));
}

let starting: Promise<void> | null = null;

/**
 * Start the host as a detached process. `detached` gives it its own session,
 * so it is not in serve's process group, and the service unit's
 * `KillMode=process` leaves it running when serve restarts.
 */
function startHost(path: string, env: NodeJS.ProcessEnv): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const logPath = join(dirname(path), "term-host.log");
  const fd = openSync(logPath, "a", 0o600);
  try {
    const child = spawn(process.execPath, [HOST_MAIN], {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...env, LFG_TERM_HOST_SOCKET: path },
      cwd: dirname(path),
    });
    child.unref();
  } finally {
    closeSync(fd);
  }
}

async function connectHost(
  handlers: Omit<ConnState, "decoder" | "pending">,
  opts: HostOptions = {},
): Promise<Socket<ConnState>> {
  const path = opts.path ?? termHostSocketPath();
  try {
    return await connectOnce(path, handlers);
  } catch (e) {
    if (opts.spawn === false) throw e;
  }
  // Single-flight the start, then wait for the socket to accept.
  starting ??= (async () => {
    startHost(path, opts.env ?? process.env);
  })();
  await starting;
  const deadline = Date.now() + 8000;
  let lastError: unknown = null;
  try {
    while (Date.now() < deadline) {
      await Bun.sleep(60);
      try {
        return await connectOnce(path, handlers);
      } catch (e) {
        lastError = e;
      }
    }
  } finally {
    starting = null;
  }
  throw new Error(`terminal host did not start: ${(lastError as Error)?.message ?? "timeout"}`);
}

export interface HostOptions {
  /** Socket path; defaults to the data directory. */
  path?: string;
  /** Environment the host is started with (its shells inherit it). */
  env?: NodeJS.ProcessEnv;
  /** Start the host when it is not running. Defaults to true. */
  spawn?: boolean;
}

/** Send one request and wait for its single reply. */
export async function termRequest(req: TermRequest, opts: HostOptions = {}): Promise<TermReply> {
  let resolve!: (r: TermReply) => void;
  let reject!: (e: Error) => void;
  const done = new Promise<TermReply>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const sock = await connectHost(
    {
      onData: () => {},
      onMessage: (m) => resolve(m),
      onClose: () => reject(new Error("terminal host closed the connection")),
    },
    opts,
  );
  const timer = setTimeout(() => reject(new Error("terminal host did not answer")), 10_000);
  try {
    send(sock, jsonFrame(req));
    return await done;
  } finally {
    clearTimeout(timer);
    sock.end();
  }
}

export async function listTerminals(prefix: string | undefined, opts: HostOptions = {}): Promise<TermShellInfo[]> {
  const r = await termRequest({ op: "list", prefix }, opts);
  if (r.op !== "list") throw new Error(r.op === "error" ? r.message : "unexpected reply");
  return r.shells;
}

export async function killTerminal(id: string, opts: HostOptions = {}): Promise<boolean> {
  const r = await termRequest({ op: "kill", id }, opts);
  if (r.op !== "killed") throw new Error(r.op === "error" ? r.message : "unexpected reply");
  return r.existed;
}

export async function runInTerminal(
  id: string,
  cwd: string,
  command: string,
  opts: HostOptions & { interrupt?: boolean } = {},
): Promise<void> {
  const r = await termRequest({ op: "run", id, cwd, command, interrupt: opts.interrupt }, opts);
  if (r.op !== "ran") throw new Error(r.op === "error" ? r.message : "unexpected reply");
}

export async function scanTerminal(
  id: string,
  opts: HostOptions = {},
): Promise<{ plain: string; escaped: string; width: number }> {
  const r = await termRequest({ op: "scan", id }, opts);
  if (r.op !== "scan") throw new Error(r.op === "error" ? r.message : "unexpected reply");
  return r;
}

export async function pingTermHost(opts: HostOptions = {}) {
  const r = await termRequest({ op: "ping" }, opts);
  if (r.op !== "pong") throw new Error("unexpected reply");
  if (r.version !== TERM_PROTOCOL_VERSION) {
    console.warn(`[term] host speaks protocol ${r.version}, serve speaks ${TERM_PROTOCOL_VERSION}`);
  }
  return r;
}

export interface TermAttachment {
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

/**
 * Attach to a shell. `onMessage` gets the `attached` reply first, then the
 * snapshot arrives through `onData`, then live output. `onClose` fires once,
 * whichever side ends it (an `exit` message precedes it when the shell ended).
 */
export async function attachTerminal(
  req: { id: string; cwd: string; cols: number; rows: number; create?: boolean },
  handlers: { onData: (d: Uint8Array) => void; onMessage: (m: TermReply) => void; onClose: () => void },
  opts: HostOptions = {},
): Promise<TermAttachment> {
  let closed = false;
  const sock = await connectHost(
    {
      onData: handlers.onData,
      onMessage: handlers.onMessage,
      onClose: () => {
        if (closed) return;
        closed = true;
        handlers.onClose();
      },
    },
    opts,
  );
  send(sock, jsonFrame({ op: "attach", ...req }));
  return {
    write: (data) => {
      if (!closed) send(sock, dataFrame(data));
    },
    resize: (cols, rows) => {
      if (!closed) send(sock, jsonFrame({ op: "resize", cols, rows }));
    },
    close: () => {
      if (closed) return;
      closed = true;
      sock.end();
    },
  };
}
