// The browser terminal's HTTP and websocket routes.
//
// serve.ts mounts these; so does the browser end-to-end harness
// (test/browser/terminal-e2e.ts), which is why they live here rather than
// inline in serve: the test drives the same code the product runs.
//
//   GET  /api/term          websocket: attach to one shell
//   GET  /api/term/list     the shells of one scope (a session, or a name)
//   POST /api/term/kill     end one shell (close its tab)
//   GET  /api/term/scan     URLs on screen, for the link tray
//
// Every shell lives in the terminal host (src/term/host.ts), not here, so a
// serve restart only drops sockets.
import type { Server, ServerWebSocket } from "bun";
import { homedir } from "node:os";
import { detectUrls } from "../links.ts";
import {
  attachTerminal,
  killTerminal,
  listTerminals,
  scanTerminal,
  type HostOptions,
  type TermAttachment,
} from "./client.ts";
import { sanitizeTermId, sessionTermScope, termIdFromQuery } from "./protocol.ts";

/** Per-socket state: which shell, where it starts, the size at connect. */
export type TermSocketData = { term: true; id: string; cwd: string; cols: number; rows: number };

type Bridge = {
  attachment: TermAttachment | null;
  /** Frames that arrived before the attach finished. */
  queue: Array<string | Uint8Array>;
  closed: boolean;
};

export interface TermRouteDeps {
  /** The working directory of an agent session, or null when unknown. */
  sessionCwd: (sessionId: string) => Promise<string | null>;
  host?: HostOptions;
  /** Extra browser origins allowed to use the terminal (the public URL). */
  allowedOrigins?: () => readonly string[];
  home?: string;
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
const fail = (status: number, message: string) => json({ error: message }, status);

// A dimension from the query, clamped so a bogus value cannot allocate an
// absurd pty winsize.
function dim(raw: string | null, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(500, n));
}

// Browser → host. Binary frames are keystrokes; text frames are JSON control
// (only resize today). Anything unparseable is ignored.
function forward(attachment: TermAttachment, frame: string | Uint8Array) {
  if (typeof frame !== "string") {
    attachment.write(frame);
    return;
  }
  try {
    const ctrl = JSON.parse(frame) as { t?: string; cols?: number; rows?: number };
    if (ctrl.t === "resize" && ctrl.cols && ctrl.rows) attachment.resize(ctrl.cols, ctrl.rows);
  } catch {}
}

const LOOPBACK_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;
const hostname = (host: string) => host.replace(/:\d+$/, "").toLowerCase();

/**
 * Whether a request may reach a shell, judged by the browser's own headers.
 *
 * Browsers let any web page open a websocket to another origin, and send a
 * simple POST there too. The terminal API has no login (see SECURITY.md), so
 * without this check a page open in the owner's browser could open a shell
 * on 127.0.0.1, type into it, or close the owner's terminals. A page cannot
 * forge `Origin` or `Sec-Fetch-Site`.
 *
 * Allowed:
 * - no `Origin` at all: not a browser page (CLI tools, tests);
 * - an `Origin` naming the host the request was sent to (`Host`, or
 *   `X-Forwarded-Host` behind `tailscale serve` or the Vite proxy): the app
 *   itself, the desktop shell, the Tailscale address;
 * - an origin in `allowedOrigins` (the configured public URL);
 * - a loopback page calling a loopback server: the Vite dev server on this
 *   machine, which proxies to serve under another port.
 *
 * Note Chrome sends `Sec-Fetch-Site` on fetches but NOT on websocket
 * handshakes, so `Origin` is the check that covers the shell socket.
 */
export function isTrustedTermRequest(req: Request, allowedOrigins: readonly string[] = []): boolean {
  if (req.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return false;
  const raw = req.headers.get("origin");
  if (raw === null) return true;
  let origin: URL;
  try {
    origin = new URL(raw);
  } catch {
    return false; // "null": a sandboxed frame, a data: or file: page
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return false;
  if (allowedOrigins.includes(origin.origin)) return true;
  const host = req.headers.get("host") ?? "";
  const forwarded = (req.headers.get("x-forwarded-host") ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if ([host, ...forwarded].some((h) => h.toLowerCase() === origin.host.toLowerCase())) return true;
  return LOOPBACK_HOST.test(origin.hostname) && LOOPBACK_HOST.test(hostname(host));
}

export function isTermSocketData(data: unknown): data is TermSocketData {
  return !!data && typeof data === "object" && (data as { term?: unknown }).term === true;
}

export function createTermRoutes(deps: TermRouteDeps) {
  const home = deps.home ?? homedir();
  const bridges = new WeakMap<object, Bridge>();

  /**
   * Resolve which shell a request wants.
   *
   * `?sessionId=<uuid>[&tab=<t>]` is one of that agent session's terminals;
   * its shell starts in the session's cwd (its worktree). `?session=<name>
   * [&tab=<t>]` is a free-form global shell (the Terminal page, the agent
   * login terminals). `scope` is the prefix every tab of the same set shares.
   */
  async function resolve(url: URL): Promise<{ id: string; cwd: string; scope: string } | null> {
    const id = termIdFromQuery(url.searchParams);
    if (!id) return null;
    const sessionId = url.searchParams.get("sessionId");
    if (sessionId) {
      const scope = sessionTermScope(sessionId);
      if (!scope) return null;
      const cwd = await deps.sessionCwd(sessionId).catch(() => null);
      return { id, cwd: cwd || home, scope };
    }
    return { id, cwd: home, scope: sanitizeTermId(url.searchParams.get("session") || "main") ?? "main" };
  }

  /**
   * Handle a terminal route. Returns a Response, `undefined` when the request
   * was upgraded to a websocket, or `null` when the path is not ours.
   */
  async function handle(req: Request, url: URL, server: Server<unknown>): Promise<Response | undefined | null> {
    const path = url.pathname;
    if (path !== "/api/term" && !path.startsWith("/api/term/")) return null;
    if (!isTrustedTermRequest(req, deps.allowedOrigins?.() ?? [])) {
      console.warn(`[term] refused ${req.method} ${path} from origin ${req.headers.get("origin")}`);
      return fail(403, "terminal requests from another site are refused");
    }
    if (path === "/api/term") {
      const target = await resolve(url);
      if (!target) return fail(400, "invalid terminal id");
      const data: TermSocketData = {
        term: true,
        id: target.id,
        cwd: target.cwd,
        cols: dim(url.searchParams.get("cols"), 80),
        rows: dim(url.searchParams.get("rows"), 24),
      };
      if ((server as Server<TermSocketData>).upgrade(req, { data })) return undefined;
      return fail(400, "expected a websocket upgrade");
    }
    if (path === "/api/term/list" && req.method === "GET") {
      const target = await resolve(url);
      if (!target) return fail(400, "invalid terminal id");
      try {
        return json({ scope: target.scope, shells: await listTerminals(target.scope, deps.host) });
      } catch (e) {
        return fail(502, e instanceof Error ? e.message : "terminal host unavailable");
      }
    }
    if (path === "/api/term/kill" && req.method === "POST") {
      const target = await resolve(url);
      if (!target) return fail(400, "invalid terminal id");
      try {
        return json({ ok: true, existed: await killTerminal(target.id, deps.host) });
      } catch (e) {
        return fail(502, e instanceof Error ? e.message : "terminal host unavailable");
      }
    }
    // A long URL is wrapped across rows on screen (and often hard-wrapped by
    // the app). The host returns the rows of its screen copy plus recent raw
    // output; detectUrls stitches the rows and reads OSC 8 targets.
    if (path === "/api/term/scan" && req.method === "GET") {
      const target = await resolve(url);
      if (!target) return fail(400, "invalid terminal id");
      try {
        const screen = await scanTerminal(target.id, deps.host);
        return json({ urls: screen.plain ? detectUrls(screen) : [] });
      } catch {
        return json({ urls: [] });
      }
    }
    return null;
  }

  function open(ws: ServerWebSocket<TermSocketData>) {
    const { id, cwd, cols, rows } = ws.data;
    const bridge: Bridge = { attachment: null, queue: [], closed: false };
    bridges.set(ws, bridge);
    const sendJson = (o: unknown) => {
      try {
        ws.send(JSON.stringify(o));
      } catch {}
    };
    void attachTerminal(
      { id, cwd: cwd || home, cols, rows },
      {
        onData: (chunk) => {
          try {
            ws.send(chunk);
          } catch {}
        },
        onMessage: (m) => {
          if (m.op === "attached") {
            sendJson({
              t: "attached",
              id: m.shell.id,
              title: m.shell.title,
              program: m.shell.program,
              cwd: m.shell.cwd,
              created: m.created,
            });
          } else if (m.op === "title") sendJson({ t: "title", title: m.title });
          else if (m.op === "exit") sendJson({ t: "exit", code: m.code });
          else if (m.op === "error") sendJson({ t: "error", message: m.message });
        },
        onClose: () => {
          bridge.closed = true;
          try {
            ws.close();
          } catch {}
        },
      },
      deps.host,
    )
      .then((attachment) => {
        if (bridge.closed) {
          attachment.close();
          return;
        }
        bridge.attachment = attachment;
        for (const queued of bridge.queue.splice(0)) forward(attachment, queued);
      })
      .catch((e) => {
        bridge.closed = true;
        sendJson({ t: "error", message: `failed to open terminal: ${(e as Error).message}` });
        try {
          ws.close();
        } catch {}
      });
  }

  function message(ws: ServerWebSocket<TermSocketData>, msg: string | Uint8Array | ArrayBuffer) {
    const bridge = bridges.get(ws);
    if (!bridge || bridge.closed) return;
    const frame = typeof msg === "string" ? msg : new Uint8Array(msg as ArrayBuffer);
    if (bridge.attachment) forward(bridge.attachment, frame);
    else if (bridge.queue.length < 256) bridge.queue.push(frame);
  }

  // Detach only. The shell keeps running in the host, so it (and any
  // in-flight OAuth or long command) survives a reconnect.
  function close(ws: ServerWebSocket<TermSocketData>) {
    const bridge = bridges.get(ws);
    bridges.delete(ws);
    if (!bridge) return;
    bridge.closed = true;
    bridge.attachment?.close();
  }

  return { resolve, handle, open, message, close };
}
