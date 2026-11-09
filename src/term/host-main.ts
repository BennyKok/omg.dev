// Entry point of the terminal host process. `lfg serve` starts it on demand
// (src/term/client.ts) as a detached process, so it and its shells survive a
// serve restart. It listens on a unix socket that only this user can open.
//
// It exits on its own after it has had no shells and no connections for a
// while, so an unused host does not linger.
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { Socket } from "bun";
import { TermHost, type TermClient } from "./host.ts";
import {
  FRAME_DATA,
  FrameDecoder,
  TERM_PROTOCOL_VERSION,
  dataFrame,
  jsonFrame,
  termHostSocketPath,
  type TermReply,
  type TermRequest,
} from "./protocol.ts";

const IDLE_EXIT_MS = Number(process.env.LFG_TERM_HOST_IDLE_MS) || 10 * 60_000;

type Conn = {
  decoder: FrameDecoder;
  /** Bytes the kernel did not take yet; flushed on `drain`. */
  pending: Uint8Array[];
  /** Set once this connection attached to a shell. */
  attached: string | null;
  client: TermClient | null;
  /** Frames that arrived while an attach was still being set up. */
  early: Array<{ kind: number; body: unknown }>;
  attaching: boolean;
};

const log = (line: string) => console.log(`[term-host ${new Date().toISOString()}] ${line}`);

function write(sock: Socket<Conn>, bytes: Uint8Array) {
  const conn = sock.data;
  if (conn.pending.length) {
    conn.pending.push(bytes);
    return;
  }
  const n = sock.write(bytes);
  if (n < bytes.length) conn.pending.push(bytes.subarray(Math.max(0, n)));
}

function flush(sock: Socket<Conn>) {
  const conn = sock.data;
  while (conn.pending.length) {
    const head = conn.pending[0];
    const n = sock.write(head);
    if (n < head.length) {
      conn.pending[0] = head.subarray(Math.max(0, n));
      return;
    }
    conn.pending.shift();
  }
}

async function isLive(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 500);
    Bun.connect({
      unix: path,
      socket: {
        open(s) {
          clearTimeout(timer);
          s.end();
          resolve(true);
        },
        connectError() {
          clearTimeout(timer);
          resolve(false);
        },
        data() {},
      },
    }).catch(() => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export async function runTermHost(path = termHostSocketPath()) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    chmodSync(dirname(path), 0o700);
  } catch {}
  if (await isLive(path)) {
    // Another host already owns the socket. Two starts racing is normal.
    log(`another host is listening on ${path}; exiting`);
    return null;
  }
  if (existsSync(path)) unlinkSync(path);

  let connections = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const host = new TermHost({ log, onEmpty: () => armIdle() });

  function armIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (host.size > 0 || connections > 0) return;
    idleTimer = setTimeout(() => {
      if (host.size === 0 && connections === 0) {
        log("idle; exiting");
        shutdown(0);
      }
    }, IDLE_EXIT_MS);
  }

  async function handleRequest(sock: Socket<Conn>, req: TermRequest) {
    const reply = (m: TermReply) => write(sock, jsonFrame(m));
    switch (req.op) {
      case "ping":
        return reply({ op: "pong", version: TERM_PROTOCOL_VERSION, pid: process.pid, shells: host.size });
      case "list":
        return reply({ op: "list", shells: host.list(req.prefix) });
      case "kill":
        return reply({ op: "killed", id: req.id, existed: host.kill(req.id) });
      case "run": {
        const created = await host.run(req.id, req.cwd, req.command, req.interrupt);
        return reply({ op: "ran", id: req.id, created });
      }
      case "scan": {
        const r = host.scan(req.id, req.lines);
        return reply({ op: "scan", id: req.id, plain: r?.plain ?? "", escaped: r?.escaped ?? "", width: r?.width ?? 80 });
      }
      case "resize":
        if (sock.data.attached) host.resize(sock.data.attached, req.cols, req.rows);
        return;
      case "attach": {
        const conn = sock.data;
        if (conn.attached || conn.attaching) return reply({ op: "error", message: "already attached" });
        conn.attaching = true;
        const client: TermClient = {
          sendData: (data) => write(sock, dataFrame(data)),
          sendMessage: (m) => write(sock, jsonFrame(m)),
          end: () => {
            conn.attached = null;
            try {
              sock.end();
            } catch {}
          },
        };
        conn.client = client;
        const id = await host.attach(client, req);
        conn.attaching = false;
        if (!id) {
          reply({ op: "error", message: `no terminal named ${req.id}` });
          sock.end();
          return;
        }
        conn.attached = id;
        // Input typed while the shell was being created goes in now, in order.
        for (const early of conn.early.splice(0)) {
          if (early.kind === FRAME_DATA) host.input(id, early.body as Uint8Array);
          else await handleRequest(sock, early.body as TermRequest);
        }
        return;
      }
    }
  }

  const server = Bun.listen<Conn>({
    unix: path,
    socket: {
      open(sock) {
        connections++;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        sock.data = { decoder: new FrameDecoder(), pending: [], attached: null, client: null, early: [], attaching: false };
      },
      data(sock, chunk) {
        const conn = sock.data;
        let frames;
        try {
          frames = conn.decoder.push(new Uint8Array(chunk));
        } catch (e) {
          log(`dropping connection: ${(e as Error).message}`);
          sock.end();
          return;
        }
        for (const frame of frames) {
          if (conn.attaching) {
            conn.early.push({ kind: frame.kind, body: frame.kind === FRAME_DATA ? frame.data : frame.message });
            continue;
          }
          if (frame.kind === FRAME_DATA) {
            if (conn.attached) host.input(conn.attached, frame.data);
            continue;
          }
          void handleRequest(sock, frame.message as TermRequest).catch((e) => {
            write(sock, jsonFrame({ op: "error", message: (e as Error).message }));
          });
        }
      },
      drain(sock) {
        flush(sock);
      },
      close(sock) {
        connections = Math.max(0, connections - 1);
        const conn = sock.data;
        if (conn.attached && conn.client) host.detach(conn.client, conn.attached);
        conn.attached = null;
        armIdle();
      },
      error(_sock, err) {
        log(`socket error: ${err.message}`);
      },
    },
  });
  try {
    chmodSync(path, 0o600);
  } catch {}
  log(`listening on ${path} (pid ${process.pid}, protocol ${TERM_PROTOCOL_VERSION})`);
  armIdle();

  function shutdown(code: number) {
    host.closeAll();
    try {
      server.stop(true);
    } catch {}
    try {
      unlinkSync(path);
    } catch {}
    process.exit(code);
  }
  // The host is detached from serve's session, so a terminal hangup or a
  // signal aimed at serve's process group does not reach it. An explicit
  // TERM/INT (an uninstall, a test) closes the shells it owns.
  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGHUP", () => {});
  return { server, host };
}

if (import.meta.main) {
  const started = await runTermHost();
  if (!started) process.exit(0);
}
