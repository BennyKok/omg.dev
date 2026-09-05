// Reaching the account's other machines from this box.
//
// The local UI is served from this box's origin. The account's cloud Computer
// and its other paired boxes are reached through omg's session origin
// (sessions.omgs.app), which answers only to a signed grant and whose CORS
// allows only the hosted dashboard. So the browser never talks to it. This
// box does: it mints a grant with the account credential it already holds
// (src/cloud-account.ts) and forwards HTTP and WebSocket traffic under
// /api/cloud/machines/<bindingId>/... on its own origin. The UI switches
// machines by prefixing paths, nothing else.
//
// One grant per binding, one mint in flight at a time, refreshed on a 401.
// The mint itself is the same POST /__omg/session-auth the hosted clients use,
// with the CLI OAuth token as the bearer. That token is accepted there only
// when it carries the omg:computer scope (vibes control-plane, PR #1639).

import { CloudAccountError, type CloudAccount } from "./cloud-account.ts";

export const CLOUD_MACHINES_PREFIX = "/api/cloud/machines/";

type Grant = { token: string; expiresAt: number };

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CloudMachineProxyOptions {
  account: Pick<CloudAccount, "getAccessToken">;
  sessionOrigin?: string;
  fetch?: FetchLike;
  WebSocket?: typeof globalThis.WebSocket;
  now?: () => number;
}

/** What a proxied client socket carries through Bun's upgrade. */
export type CloudProxySocketData = {
  cloudProxy: { bindingId: string; path: string };
};

/** The subset of Bun's ServerWebSocket this proxy needs. */
export interface ProxyClientSocket {
  data: unknown;
  readyState: number;
  send(data: string | ArrayBufferLike | ArrayBufferView): unknown;
  close(code?: number, reason?: string): void;
}

export interface CloudMachineProxy {
  /** Parse `/api/cloud/machines/<id>/<rest>`; null for any other path. */
  target(url: URL): { bindingId: string; path: string } | null;
  /** Forward one HTTP request. Callers have already matched `target`. */
  handleHttp(req: Request, url: URL): Promise<Response>;
  /** Data for `server.upgrade` on a WebSocket request under the prefix. */
  upgradeData(url: URL): CloudProxySocketData | null;
  isProxySocket(ws: ProxyClientSocket): boolean;
  open(ws: ProxyClientSocket): void;
  message(ws: ProxyClientSocket, message: string | ArrayBufferLike | ArrayBufferView): void;
  close(ws: ProxyClientSocket): void;
  /** Drop cached grants, e.g. after sign-out. */
  reset(): void;
}

const DEFAULT_SESSION_ORIGIN = "https://sessions.omgs.app";
const SESSION_AUTH_PATH = "/__omg/session-auth";
const GRANT_SKEW_MS = 30_000;
const SOCKET_OPEN = 1;

// Hop-by-hop and origin-bound headers that must not cross the proxy.
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "cookie",
  "origin",
  "referer",
  "authorization",
  "content-length",
]);
const STRIP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "set-cookie",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-expose-headers",
]);

/** Everything after the binding id, query included, or null when not ours. */
export function parseMachinePath(url: URL): { bindingId: string; path: string } | null {
  if (!url.pathname.startsWith(CLOUD_MACHINES_PREFIX)) return null;
  const rest = url.pathname.slice(CLOUD_MACHINES_PREFIX.length);
  const slash = rest.indexOf("/");
  const bindingId = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash)).trim();
  if (!bindingId || bindingId.includes("/") || bindingId === "..") return null;
  const path = (slash === -1 ? "/" : rest.slice(slash)) + url.search;
  return { bindingId, path };
}

export function createCloudMachineProxy(options: CloudMachineProxyOptions): CloudMachineProxy {
  const sessionOrigin = (
    options.sessionOrigin ?? (process.env.OMG_SESSION_ORIGIN?.trim() || DEFAULT_SESSION_ORIGIN)
  ).replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
  const now = options.now ?? Date.now;
  const grants = new Map<string, { cached: Grant | null; pending: Promise<Grant> | null }>();
  const upstreams = new WeakMap<object, { socket: WebSocket | null; queue: Array<string | ArrayBufferLike | ArrayBufferView>; closed: boolean }>();

  async function mint(bindingId: string): Promise<Grant> {
    const token = await options.account.getAccessToken();
    if (!token) throw new CloudAccountError("Not signed in to omg Cloud.", 401);
    let response: Response;
    try {
      response = await fetchImpl(`${sessionOrigin}${SESSION_AUTH_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ bindingId }),
      });
    } catch {
      throw new CloudAccountError("Couldn't reach omg Cloud. Try again in a moment.", 502);
    }
    if (response.status === 401) {
      throw new CloudAccountError(
        "omg Cloud did not accept this sign-in for computer access.",
        401,
      );
    }
    if (response.status === 403) {
      throw new CloudAccountError("This computer isn't available to your account.", 403);
    }
    if (response.status === 402) {
      throw new CloudAccountError("Your included computer time is used up.", 402);
    }
    if (!response.ok) {
      throw new CloudAccountError(`Couldn't open this computer (${response.status}).`, 502);
    }
    const body = (await response.json().catch(() => null)) as {
      cookie?: string;
      exp?: number;
      expiresInMs?: number;
    } | null;
    if (!body?.cookie) throw new CloudAccountError("This computer is updating. Try again in a moment.", 502);
    const expiresAt =
      typeof body.expiresInMs === "number"
        ? now() + body.expiresInMs
        : typeof body.exp === "number"
          ? body.exp
          : now();
    return { token: body.cookie, expiresAt };
  }

  async function grantFor(bindingId: string, forceRefresh = false): Promise<Grant> {
    let entry = grants.get(bindingId);
    if (!entry) {
      entry = { cached: null, pending: null };
      grants.set(bindingId, entry);
    }
    if (!forceRefresh && entry.cached && entry.cached.expiresAt - now() > GRANT_SKEW_MS) {
      return entry.cached;
    }
    if (!forceRefresh && entry.pending) return entry.pending;
    const current = entry;
    current.pending = mint(bindingId)
      .then((grant) => {
        current.cached = grant;
        return grant;
      })
      .finally(() => {
        current.pending = null;
      });
    return current.pending;
  }

  function errorResponse(error: unknown): Response {
    const status = error instanceof CloudAccountError ? error.status : 502;
    const message = error instanceof Error ? error.message : "Cloud machine request failed.";
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  async function handleHttp(req: Request, url: URL): Promise<Response> {
    const target = parseMachinePath(url);
    if (!target) return errorResponse(new CloudAccountError("not found", 404));
    // Read the body once: a retry after a 401 must send the same bytes, and a
    // request body stream cannot be replayed.
    const body =
      req.method === "GET" || req.method === "HEAD" ? undefined : new Uint8Array(await req.arrayBuffer());
    const headers = new Headers();
    req.headers.forEach((value, name) => {
      if (!STRIP_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
    });
    // The upstream is the machine, so the viewer is whoever this box says.
    // The proxy on the session origin stamps the viewer from the grant.
    const send = async (forceRefresh: boolean) => {
      const grant = await grantFor(target.bindingId, forceRefresh);
      const attempt = new Headers(headers);
      attempt.set("Authorization", `Bearer ${grant.token}`);
      return fetchImpl(`${sessionOrigin}${target.path}`, {
        method: req.method,
        headers: attempt,
        body,
        redirect: "manual",
      });
    };
    try {
      let upstream = await send(false);
      if (upstream.status === 401) upstream = await send(true);
      const out = new Headers();
      upstream.headers.forEach((value, name) => {
        if (!STRIP_RESPONSE_HEADERS.has(name.toLowerCase())) out.set(name, value);
      });
      return new Response(upstream.body, { status: upstream.status, headers: out });
    } catch (error) {
      return errorResponse(error);
    }
  }

  function upgradeData(url: URL): CloudProxySocketData | null {
    const target = parseMachinePath(url);
    return target ? { cloudProxy: target } : null;
  }

  function isProxySocket(ws: ProxyClientSocket): boolean {
    const data = ws.data as Partial<CloudProxySocketData> | null;
    return Boolean(data && typeof data === "object" && "cloudProxy" in data && data.cloudProxy);
  }

  function open(ws: ProxyClientSocket): void {
    const { bindingId, path } = (ws.data as CloudProxySocketData).cloudProxy;
    const state = { socket: null as WebSocket | null, queue: [] as Array<string | ArrayBufferLike | ArrayBufferView>, closed: false };
    upstreams.set(ws, state);
    void grantFor(bindingId)
      .then((grant) => {
        if (state.closed) return;
        const upstreamUrl = `${sessionOrigin.replace(/^http/, "ws")}${path}`;
        const socket = new WebSocketImpl(upstreamUrl, [`lfg-bearer.${grant.token}`]);
        socket.binaryType = "arraybuffer";
        state.socket = socket;
        socket.addEventListener("open", () => {
          for (const frame of state.queue.splice(0)) socket.send(frame as never);
        });
        socket.addEventListener("message", (event: MessageEvent) => {
          if (ws.readyState !== SOCKET_OPEN) return;
          const data = event.data as string | ArrayBuffer | ArrayBufferView;
          ws.send(data);
        });
        socket.addEventListener("close", (event: CloseEvent) => {
          state.closed = true;
          if (ws.readyState === SOCKET_OPEN) ws.close(closeCode(event.code), event.reason?.slice(0, 120));
        });
        socket.addEventListener("error", () => {
          if (ws.readyState === SOCKET_OPEN) ws.close(1011, "upstream error");
        });
      })
      .catch((error: unknown) => {
        state.closed = true;
        const reason = error instanceof Error ? error.message : "grant failed";
        if (ws.readyState === SOCKET_OPEN) ws.close(1008, reason.slice(0, 120));
      });
  }

  function message(ws: ProxyClientSocket, frame: string | ArrayBufferLike | ArrayBufferView): void {
    const state = upstreams.get(ws);
    if (!state || state.closed) return;
    if (state.socket && state.socket.readyState === SOCKET_OPEN) {
      state.socket.send(frame as never);
    } else {
      state.queue.push(frame);
    }
  }

  function close(ws: ProxyClientSocket): void {
    const state = upstreams.get(ws);
    if (!state) return;
    state.closed = true;
    upstreams.delete(ws);
    const socket = state.socket;
    if (socket && (socket.readyState === SOCKET_OPEN || socket.readyState === 0)) socket.close();
  }

  return {
    target: parseMachinePath,
    handleHttp,
    upgradeData,
    isProxySocket,
    open,
    message,
    close,
    reset: () => grants.clear(),
  };
}

// Only codes a server may send onward. 1005/1006 are reserved for the local
// side and Bun rejects them; anything else in the private range passes.
function closeCode(code: number): number {
  if (code === 1005 || code === 1006 || code < 1000) return 1011;
  return code;
}
