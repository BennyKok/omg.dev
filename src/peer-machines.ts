// Linking and proxying remote omg.dev machines from this box.
//
// Each self-hosted omg.dev box can link other omg.dev boxes by URL + optional
// bearer token (for example a Tailscale Serve URL `https://studio.tailnet.ts.net`
// or a LAN/tunnel URL `http://192.168.1.42:8766#omg_peer_...`).
//
// Just like the former cloud machine proxy, the browser never talks directly to
// remote origins (avoiding CORS, mixed-content, and exposing bearer tokens in
// localStorage). Instead:
//   - `/api/peers` manages linked machines and this box's inbound pairing code.
//   - `/api/peers/fleet` aggregates live sessions and online status across all
//     linked machines for the unified sidebar.
//   - `/api/peers/machines/<peerId>/...` proxies HTTP and WebSocket traffic to
//     the selected remote omg.dev instance so `createSameOriginTransport` can
//     switch the entire UI onto any linked machine with a single basePath swap.

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { PATHS } from "./config.ts";
import { isTrustedTermRequest } from "./term/routes.ts";

export const PEER_MACHINES_PREFIX = "/api/peers/machines/";

export type LinkedPeerRecord = {
  id: string;
  name: string;
  url: string;
  token: string;
  addedAt: number;
};

export type PublicLinkedPeer = {
  id: string;
  name: string;
  url: string;
  addedAt: number;
  hasToken: boolean;
};

export type PeerStoreFile = {
  peerToken: string;
  /**
   * Whether other omg.dev boxes may reach this one with `peerToken` over the
   * tailnet listener. Off until the owner turns it on in Settings > Remote
   * access: the token gives full control of this box, and the tailnet gate
   * otherwise opens nothing (src/tailnet-gate.ts).
   */
  inboundEnabled: boolean;
  peers: LinkedPeerRecord[];
};

export type PeerFleetSession = Record<string, unknown> & {
  sessionId?: string | null;
  peerId: string;
  peerName: string;
};

export type PeerFleetNode = {
  id: string;
  name: string;
  url: string;
  online: boolean;
  error?: string;
  sessionCount: number;
  busyCount: number;
  sessions: PeerFleetSession[];
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const SOCKET_OPEN = 1;

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
  "set-cookie",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-expose-headers",
]);

export function peersStorePath(dataDir: string = PATHS.data): string {
  return join(dataDir, "peers.json");
}

function generatePeerToken(): string {
  return `omg_peer_${randomBytes(24).toString("base64url")}`;
}

export function normalizePeerUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    parsed.hash = "";
    parsed.search = "";
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${path}`;
  } catch {
    return null;
  }
}

/**
 * Parse either a combined pairing string (`https://host:8766#omg_peer_...` or
 * `https://host:8766?token=omg_peer_...`) or separate URL + token fields.
 */
export function parsePeerPairingInput(input: {
  pairingCode?: string | null;
  url?: string | null;
  token?: string | null;
  name?: string | null;
}): { url: string; token: string; suggestedName: string } | { error: string } {
  const rawCode = input.pairingCode?.trim() || input.url?.trim() || "";
  if (!rawCode) return { error: "Enter a remote omg.dev URL or pairing code." };

  let extractedToken = input.token?.trim() ?? "";
  let urlCandidate = rawCode;

  if (rawCode.includes("#")) {
    const [beforeHash, afterHash] = rawCode.split("#", 2);
    urlCandidate = beforeHash.trim();
    if (!extractedToken && afterHash?.trim()) {
      extractedToken = afterHash.trim();
    }
  }

  const withScheme = /^https?:\/\//i.test(urlCandidate) ? urlCandidate : `http://${urlCandidate}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { error: "Invalid remote omg.dev URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "Remote omg.dev URL must use http:// or https://." };
  }

  if (!extractedToken) {
    const queryToken = parsed.searchParams.get("token") ?? parsed.searchParams.get("peer_token");
    if (queryToken?.trim()) extractedToken = queryToken.trim();
  }

  const normalized = normalizePeerUrl(`${parsed.origin}${parsed.pathname}`);
  if (!normalized) return { error: "Invalid remote omg.dev URL." };

  const customName = input.name?.trim();
  const hostLabel = parsed.hostname.replace(/\.ts\.net$/i, "").split(".")[0] || parsed.host;
  return {
    url: normalized,
    token: extractedToken,
    suggestedName: customName || hostLabel,
  };
}

export function readPeerStore(dataDir: string = PATHS.data): PeerStoreFile {
  const path = peersStorePath(dataDir);
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<PeerStoreFile>;
      const peerToken =
        typeof raw.peerToken === "string" && raw.peerToken.trim().length >= 16
          ? raw.peerToken.trim()
          : generatePeerToken();
      const peers = Array.isArray(raw.peers)
        ? raw.peers.filter(
            (p): p is LinkedPeerRecord =>
              Boolean(
                p &&
                  typeof p === "object" &&
                  typeof p.id === "string" &&
                  p.id.trim() &&
                  typeof p.url === "string" &&
                  normalizePeerUrl(p.url),
              ),
          ).map((p) => ({
            id: p.id.trim(),
            name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : new URL(p.url).hostname,
            url: normalizePeerUrl(p.url)!,
            token: typeof p.token === "string" ? p.token.trim() : "",
            addedAt: typeof p.addedAt === "number" ? p.addedAt : Date.now(),
          }))
        : [];
      const inboundEnabled = raw.inboundEnabled === true;
      if (raw.peerToken !== peerToken) {
        writePeerStore({ peerToken, inboundEnabled, peers }, dataDir);
      }
      return { peerToken, inboundEnabled, peers };
    }
  } catch {
    // Re-initialize on corrupt file.
  }
  const initial: PeerStoreFile = {
    peerToken: generatePeerToken(),
    inboundEnabled: false,
    peers: [],
  };
  writePeerStore(initial, dataDir);
  return initial;
}

export function writePeerStore(store: PeerStoreFile, dataDir: string = PATHS.data): void {
  const path = peersStorePath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * The token the tailnet gate accepts from linked boxes, or null while inbound
 * access is off. Null makes the gate reject every peer request.
 */
export function getLocalPeerToken(dataDir: string = PATHS.data): string | null {
  const store = readPeerStore(dataDir);
  return store.inboundEnabled ? store.peerToken : null;
}

/** Turns inbound peer access on or off. Turning it on issues a fresh token. */
export function setInboundPeerAccess(enabled: boolean, dataDir: string = PATHS.data): PeerStoreFile {
  const store = readPeerStore(dataDir);
  if (enabled && !store.inboundEnabled) store.peerToken = generatePeerToken();
  store.inboundEnabled = enabled;
  writePeerStore(store, dataDir);
  return store;
}

export function rotateLocalPeerToken(dataDir: string = PATHS.data): string {
  const store = readPeerStore(dataDir);
  store.peerToken = generatePeerToken();
  writePeerStore(store, dataDir);
  return store.peerToken;
}

export function toPublicPeer(peer: LinkedPeerRecord): PublicLinkedPeer {
  return {
    id: peer.id,
    name: peer.name,
    url: peer.url,
    addedAt: peer.addedAt,
    hasToken: Boolean(peer.token),
  };
}

export function parsePeerMachinePath(url: URL): { peerId: string; path: string } | null {
  if (!url.pathname.startsWith(PEER_MACHINES_PREFIX)) return null;
  const rest = url.pathname.slice(PEER_MACHINES_PREFIX.length);
  const slash = rest.indexOf("/");
  const peerId = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash)).trim();
  if (!peerId || peerId.includes("/") || peerId === "..") return null;
  const path = (slash === -1 ? "/" : rest.slice(slash)) + url.search;
  return { peerId, path };
}

export function rewritePeerRedirectLocation(
  location: string,
  peerOrigin: string,
  peerId: string,
): string | null {
  const prefix = `${PEER_MACHINES_PREFIX}${encodeURIComponent(peerId)}`;
  if (location.startsWith("/")) {
    if (location.startsWith(`${prefix}/`) || location === prefix) return null;
    if (location.startsWith("//")) return null;
    return `${prefix}${location}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    return null;
  }
  if (parsed.origin !== new URL(peerOrigin).origin) return null;
  return `${prefix}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export type PeerProxySocketData = {
  peerProxy: { peerId: string; path: string };
};

export interface ProxyClientSocket {
  data: unknown;
  readyState: number;
  send(data: string | ArrayBufferLike | ArrayBufferView): unknown;
  close(code?: number, reason?: string): void;
}

export interface PeerMachineProxy {
  target(url: URL): { peerId: string; path: string } | null;
  handleHttp(req: Request, url: URL): Promise<Response>;
  /** Socket data for an upgrade, or null to refuse it (unknown peer or untrusted page). */
  upgradeData(req: Request, url: URL): PeerProxySocketData | null;
  isProxySocket(ws: ProxyClientSocket): boolean;
  open(ws: ProxyClientSocket): void;
  message(ws: ProxyClientSocket, message: string | ArrayBufferLike | ArrayBufferView): void;
  close(ws: ProxyClientSocket): void;
}

function closeCode(code: number): number {
  if (code === 1005 || code === 1006 || code < 1000) return 1011;
  return code;
}

/**
 * Whether a browser request may use the proxy. The same rule as the terminal
 * (src/term/routes.ts): refuse a cross-site page, and an `Origin` that is not
 * this box. The proxy adds the linked box's token and strips `Origin`, so the
 * linked box cannot apply this check itself. Without it, any web page could
 * open a websocket through this box to the linked box's terminal.
 */
export function isTrustedPeerProxyRequest(req: Request, allowedOrigins: readonly string[] = []): boolean {
  return isTrustedTermRequest(req, allowedOrigins);
}

export function createPeerMachineProxy(options: {
  dataDir?: string;
  fetch?: FetchLike;
  WebSocket?: typeof globalThis.WebSocket;
  /** Extra browser origins that may use the proxy (this box's public URL). */
  allowedOrigins?: () => readonly string[];
} = {}): PeerMachineProxy {
  const dataDir = options.dataDir ?? PATHS.data;
  const trusted = (req: Request) => isTrustedPeerProxyRequest(req, options.allowedOrigins?.() ?? []);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
  const upstreams = new WeakMap<
    object,
    {
      socket: WebSocket | null;
      queue: Array<string | ArrayBufferLike | ArrayBufferView>;
      closed: boolean;
    }
  >();

  function findPeer(peerId: string): LinkedPeerRecord | null {
    const store = readPeerStore(dataDir);
    return store.peers.find((p) => p.id === peerId) ?? null;
  }

  function errorResponse(message: string, status = 502): Response {
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  async function handleHttp(req: Request, url: URL): Promise<Response> {
    const target = parsePeerMachinePath(url);
    if (!target) return errorResponse("not found", 404);
    if (!trusted(req)) return errorResponse("Open omg.dev itself to use a linked machine.", 403);
    const peer = findPeer(target.peerId);
    if (!peer) return errorResponse(`Unknown linked machine "${target.peerId}".`, 404);

    const body =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : new Uint8Array(await req.arrayBuffer());
    const headers = new Headers();
    req.headers.forEach((value, name) => {
      if (!STRIP_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
    });
    if (peer.token) {
      headers.set("Authorization", `Bearer ${peer.token}`);
    }

    try {
      const upstream = await fetchImpl(`${peer.url}${target.path}`, {
        method: req.method,
        headers,
        body,
        redirect: "manual",
      });
      const out = new Headers();
      upstream.headers.forEach((value, name) => {
        if (!STRIP_RESPONSE_HEADERS.has(name.toLowerCase())) out.set(name, value);
      });
      if (upstream.headers.has("content-encoding")) out.delete("content-length");
      // The proxied response is served from THIS box's origin. A linked box
      // is controlled from here, not trusted by it: its HTML must not run as
      // this origin, where it could drive the local API. `sandbox` without
      // allow-same-origin gives any document an opaque origin. Appended, so a
      // stricter policy from the remote still applies.
      out.append("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups allow-downloads");
      out.set("X-Content-Type-Options", "nosniff");
      const location = upstream.headers.get("location");
      if (location) {
        const rewritten = rewritePeerRedirectLocation(location, peer.url, peer.id);
        if (rewritten) out.set("location", rewritten);
      }
      return new Response(upstream.body, { status: upstream.status, headers: out });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to reach remote machine.";
      return errorResponse(`Could not reach ${peer.name} (${peer.url}): ${detail}`, 502);
    }
  }

  function upgradeData(req: Request, url: URL): PeerProxySocketData | null {
    const target = parsePeerMachinePath(url);
    if (!target) return null;
    if (!trusted(req)) return null;
    if (!findPeer(target.peerId)) return null;
    return { peerProxy: target };
  }

  function isProxySocket(ws: ProxyClientSocket): boolean {
    const data = ws.data as Partial<PeerProxySocketData> | null;
    return Boolean(data && typeof data === "object" && "peerProxy" in data && data.peerProxy);
  }

  function open(ws: ProxyClientSocket): void {
    const { peerId, path } = (ws.data as PeerProxySocketData).peerProxy;
    const peer = findPeer(peerId);
    if (!peer) {
      if (ws.readyState === SOCKET_OPEN) ws.close(1008, "Unknown peer machine");
      return;
    }
    const state = {
      socket: null as WebSocket | null,
      queue: [] as Array<string | ArrayBufferLike | ArrayBufferView>,
      closed: false,
    };
    upstreams.set(ws, state);

    try {
      const upstreamUrl = `${peer.url.replace(/^http/i, "ws")}${path}`;
      const protocols = peer.token ? [`lfg-bearer.${peer.token}`] : undefined;
      const socket = protocols
        ? new WebSocketImpl(upstreamUrl, protocols)
        : new WebSocketImpl(upstreamUrl);
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
        if (ws.readyState === SOCKET_OPEN) {
          ws.close(closeCode(event.code), event.reason?.slice(0, 120));
        }
      });
      socket.addEventListener("error", () => {
        if (ws.readyState === SOCKET_OPEN) ws.close(1011, "upstream error");
      });
    } catch (error) {
      state.closed = true;
      const reason = error instanceof Error ? error.message : "connect failed";
      if (ws.readyState === SOCKET_OPEN) ws.close(1011, reason.slice(0, 120));
    }
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
    if (socket && (socket.readyState === SOCKET_OPEN || socket.readyState === 0)) {
      socket.close();
    }
  }

  return {
    target: parsePeerMachinePath,
    handleHttp,
    upgradeData,
    isProxySocket,
    open,
    message,
    close,
  };
}

async function probeRemotePeer(
  url: string,
  token: string,
  fetchImpl: FetchLike,
  timeoutMs = 3_500,
): Promise<{ ok: boolean; machineName?: string; error?: string; status?: number }> {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    const response = await fetchImpl(`${url}/api/settings`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        status: response.status,
        error: "Remote omg.dev rejected the pairing token (401 Unauthorized).",
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `Remote omg.dev returned HTTP ${response.status}.`,
      };
    }
    const body = (await response.json().catch(() => null)) as {
      settings?: { machineName?: unknown };
      machineName?: unknown;
    } | null;
    const rawName =
      typeof body?.settings?.machineName === "string"
        ? body.settings.machineName.trim()
        : typeof body?.machineName === "string"
          ? body.machineName.trim()
          : "";
    return { ok: true, ...(rawName ? { machineName: rawName } : {}) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not connect to remote omg.dev.",
    };
  }
}

export async function fetchPeersFleet(options: {
  dataDir?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
} = {}): Promise<{ peers: PeerFleetNode[]; sessions: PeerFleetSession[] }> {
  const dataDir = options.dataDir ?? PATHS.data;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 3_500;
  const store = readPeerStore(dataDir);

  if (store.peers.length === 0) {
    return { peers: [], sessions: [] };
  }

  const nodes = await Promise.all(
    store.peers.map(async (peer): Promise<PeerFleetNode> => {
      const headers = new Headers();
      if (peer.token) headers.set("Authorization", `Bearer ${peer.token}`);
      try {
        const [sessionsRes, settingsRes] = await Promise.all([
          fetchImpl(`${peer.url}/api/sessions`, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(timeoutMs),
          }),
          fetchImpl(`${peer.url}/api/settings`, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(timeoutMs),
          }).catch(() => null),
        ]);

        if (!sessionsRes.ok) {
          return {
            id: peer.id,
            name: peer.name,
            url: peer.url,
            online: false,
            error:
              sessionsRes.status === 401
                ? "Unauthorized (check pairing token)"
                : `HTTP ${sessionsRes.status}`,
            sessionCount: 0,
            busyCount: 0,
            sessions: [],
          };
        }

        const sessionsBody = (await sessionsRes.json().catch(() => null)) as {
          sessions?: Array<Record<string, unknown>>;
        } | null;
        const settingsBody = settingsRes?.ok
          ? ((await settingsRes.json().catch(() => null)) as {
              settings?: { machineName?: unknown };
            } | null)
          : null;
        const remoteName =
          typeof settingsBody?.settings?.machineName === "string" &&
          settingsBody.settings.machineName.trim()
            ? settingsBody.settings.machineName.trim()
            : peer.name;

        const rawSessions = Array.isArray(sessionsBody?.sessions) ? sessionsBody.sessions : [];
        const annotated: PeerFleetSession[] = rawSessions
          .filter((s) => s && typeof s === "object" && typeof s.sessionId === "string" && s.sessionId)
          .map((s) => ({
            ...s,
            peerId: peer.id,
            peerName: remoteName,
          }));
        const busyCount = annotated.filter((s) => Boolean(s.busy)).length;

        return {
          id: peer.id,
          name: remoteName,
          url: peer.url,
          online: true,
          sessionCount: annotated.length,
          busyCount,
          sessions: annotated,
        };
      } catch (error) {
        return {
          id: peer.id,
          name: peer.name,
          url: peer.url,
          online: false,
          error: error instanceof Error ? error.message : "Offline",
          sessionCount: 0,
          busyCount: 0,
          sessions: [],
        };
      }
    }),
  );

  const sessions = nodes.flatMap((node) => node.sessions);
  return { peers: nodes, sessions };
}

export async function handlePeersRequest(
  req: Request,
  url: URL,
  deps: {
    dataDir?: string;
    fetch?: FetchLike;
    localMachineName: () => string;
    renameLocalMachine?: (name: string) => Promise<void>;
    localUrl: () => string;
    tailscaleUrl?: () => Promise<string | null>;
  },
): Promise<Response | null> {
  const dataDir = deps.dataDir ?? PATHS.data;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const path = url.pathname;

  if (path === "/api/peers" && req.method === "GET") {
    const store = readPeerStore(dataDir);
    const localUrl = deps.localUrl();
    const tailscaleUrl = (await deps.tailscaleUrl?.().catch(() => null)) ?? null;
    const preferredUrl = tailscaleUrl || localUrl;
    const selfName = deps.localMachineName().trim() || hostname();
    return Response.json({
      self: {
        id: "local",
        name: selfName,
        localUrl,
        tailscaleUrl,
        inboundEnabled: store.inboundEnabled,
        // The pairing code is a full-control credential. It exists only while
        // inbound access is on.
        pairingCode: store.inboundEnabled ? `${preferredUrl}#${store.peerToken}` : null,
      },
      peers: store.peers.map(toPublicPeer),
    });
  }

  if (path === "/api/peers/fleet" && req.method === "GET") {
    const fleet = await fetchPeersFleet({ dataDir, fetch: fetchImpl });
    return Response.json(fleet);
  }

  if (path === "/api/peers/inbound" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== "boolean") {
      return Response.json({ error: "Send { enabled: true | false }." }, { status: 400 });
    }
    const store = setInboundPeerAccess(body.enabled, dataDir);
    return Response.json({ ok: true, inboundEnabled: store.inboundEnabled });
  }

  if (path === "/api/peers/token" && req.method === "POST") {
    if (!readPeerStore(dataDir).inboundEnabled) {
      return Response.json({ error: "Allow linking from other machines first." }, { status: 409 });
    }
    const peerToken = rotateLocalPeerToken(dataDir);
    const localUrl = deps.localUrl();
    const tailscaleUrl = (await deps.tailscaleUrl?.().catch(() => null)) ?? null;
    const preferredUrl = tailscaleUrl || localUrl;
    return Response.json({
      ok: true,
      pairingCode: `${preferredUrl}#${peerToken}`,
    });
  }

  if (path === "/api/peers" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as {
      pairingCode?: string;
      url?: string;
      token?: string;
      name?: string;
      allowOffline?: boolean;
    } | null;
    const parsed = parsePeerPairingInput({
      pairingCode: body?.pairingCode,
      url: body?.url,
      token: body?.token,
      name: body?.name,
    });
    if ("error" in parsed) {
      return Response.json({ error: parsed.error }, { status: 400 });
    }

    const probe = await probeRemotePeer(parsed.url, parsed.token, fetchImpl);
    if (!probe.ok && !body?.allowOffline) {
      return Response.json(
        {
          error: probe.error ?? `Could not reach ${parsed.url}.`,
          unreachable: probe.status === undefined,
        },
        { status: probe.status === 401 || probe.status === 403 ? 401 : 502 },
      );
    }

    const store = readPeerStore(dataDir);
    const existing = store.peers.find((p) => p.url === parsed.url);
    const chosenName =
      body?.name?.trim() || probe.machineName || existing?.name || parsed.suggestedName;

    let saved: LinkedPeerRecord;
    if (existing) {
      existing.name = chosenName;
      if (parsed.token) existing.token = parsed.token;
      saved = existing;
    } else {
      saved = {
        id: `peer-${randomUUID().slice(0, 8)}`,
        name: chosenName,
        url: parsed.url,
        token: parsed.token,
        addedAt: Date.now(),
      };
      store.peers.push(saved);
    }
    writePeerStore(store, dataDir);
    return Response.json({
      ok: true,
      online: probe.ok,
      peer: toPublicPeer(saved),
      peers: store.peers.map(toPublicPeer),
    });
  }

  if (path === "/api/peers" && req.method === "PATCH") {
    const body = (await req.json().catch(() => null)) as {
      id?: string;
      name?: string;
      url?: string;
      token?: string;
    } | null;
    const id = body?.id?.trim();
    if (!id) return Response.json({ error: "Missing machine id." }, { status: 400 });

    if (id === "local") {
      const nextName = body?.name?.trim() ?? "";
      if (!nextName) return Response.json({ error: "Enter a machine name." }, { status: 400 });
      await deps.renameLocalMachine?.(nextName);
      return Response.json({ ok: true, id: "local", name: nextName });
    }

    const store = readPeerStore(dataDir);
    const peer = store.peers.find((p) => p.id === id);
    if (!peer) return Response.json({ error: "Linked machine not found." }, { status: 404 });

    if (typeof body?.name === "string" && body.name.trim()) {
      peer.name = body.name.trim();
    }
    if (typeof body?.url === "string" && body.url.trim()) {
      const normalized = normalizePeerUrl(body.url);
      if (!normalized) return Response.json({ error: "Invalid remote URL." }, { status: 400 });
      peer.url = normalized;
    }
    if (typeof body?.token === "string") {
      peer.token = body.token.trim();
    }
    writePeerStore(store, dataDir);
    return Response.json({
      ok: true,
      peer: toPublicPeer(peer),
      peers: store.peers.map(toPublicPeer),
    });
  }

  if (path === "/api/peers" && req.method === "DELETE") {
    const queryId = url.searchParams.get("id")?.trim();
    const body = queryId
      ? null
      : ((await req.json().catch(() => null)) as { id?: string } | null);
    const id = queryId || body?.id?.trim();
    if (!id) return Response.json({ error: "Missing machine id." }, { status: 400 });

    const store = readPeerStore(dataDir);
    const before = store.peers.length;
    store.peers = store.peers.filter((p) => p.id !== id);
    if (store.peers.length === before) {
      return Response.json({ error: "Linked machine not found." }, { status: 404 });
    }
    writePeerStore(store, dataDir);
    return Response.json({
      ok: true,
      peers: store.peers.map(toPublicPeer),
    });
  }

  return null;
}
