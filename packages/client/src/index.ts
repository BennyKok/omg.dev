import { RealtimeConnection, type RealtimeEnvironment, type RealtimeState } from "@omg-dev/sdk/realtime";
import type {
  OmgAiStreamPart,
  OmgLiveChannel,
  OmgLiveMessage,
  OmgMessage,
  OmgMessagesResponse,
  OmgSendResponse,
  OmgSession,
  OmgSessionsResponse,
  OmgTranscriptEvent,
  OmgLiveCapabilities,
  OmgDraft,
  OmgStatusRow,
  OmgQueueMessage,
  OmgChangeTopic,
} from "@omg-dev/protocol";

export type {
  OmgChangeTopic,
  OmgAiStreamPart,
  OmgLiveChannel,
  OmgLiveMessage,
  OmgMessage,
  OmgQueueMessage,
  OmgSession,
  OmgSessionPrompt,
  OmgStatusRow,
  OmgTranscriptEvent,
  OmgLiveCapabilities,
  OmgDraft,
} from "@omg-dev/protocol";

export interface OmgSocket {
  binaryType: BinaryType;
  readonly readyState: number;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code?: number; reason?: string }) => void): void;
  addEventListener(type: "error", listener: () => void): void;
}

export interface OmgUploadProgress {
  loaded: number;
  total: number;
  lengthComputable: boolean;
}

export interface OmgTransport {
  /**
   * Authenticated raw HTTP access for application surfaces that consume
   * streams, blobs, or response headers. Small data clients can stay on
   * `request`, which parses JSON and normalizes errors.
   */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /**
   * Authenticated upload access with byte-level progress when the transport
   * can provide it. Older/custom transports may omit this; callers should
   * fall back to `fetch`.
   */
  upload?(
    path: string,
    init: RequestInit,
    onProgress: (progress: OmgUploadProgress) => void,
  ): Promise<Response>;
  request<T>(path: string, init?: RequestInit): Promise<T>;
  /**
   * A URL the BROWSER itself can load, for `<img src>` / `<video src>`.
   *
   * Only a transport that needs no per-request credential can answer this: an
   * element attribute carries no `Authorization` header, so a transport that
   * signs each request must return `null` (or omit the method) and let the
   * caller fetch bytes and build a blob instead.
   *
   * Answering it is worth a lot. A blob URL is owned by one mounted component,
   * so a virtualized list re-downloads and re-decodes the same picture every
   * time a row scrolls back into view. A plain URL is cached by the browser
   * under its own rules, survives unmount, and needs no revoke.
   */
  assetUrl?(path: string): string | null;
  /**
   * Resolve a URL an element or native media player can load itself.
   *
   * This is asynchronous because an authenticated host can need to mint or
   * refresh a short-lived grant before it can put a signed URL in `src`.
   * Callers should prefer `assetUrl` when it returns a string, then try this,
   * then fall back to moving the bytes through `fetch`.
   */
  resolveAssetUrl?(path: string): Promise<string | null>;
  /**
   * Authenticated WebSocket access for application surfaces such as live
   * transcripts and terminals. Hosts own this boundary just like HTTP: an
   * embedded surface must never infer a socket origin from `location`.
   */
  openSocket(path: string): Promise<OmgSocket>;
  /**
   * `query` is an already-encoded query string appended to the live endpoint.
   * Optional and additive: a host implementation that ignores it opens the
   * socket exactly as before, and simply reports no typing identity.
   */
  openLiveSocket(query?: string): Promise<OmgSocket>;
}

export interface OmgGrant {
  /** Trusted regional origin returned by the authenticated grant minter. */
  sessionOrigin?: string;
  token: string;
  expiresAt: number;
}

export interface CreateGrantTransportOptions {
  baseUrl: string;
  getGrant: (input: { forceRefresh: boolean }) => Promise<OmgGrant>;
  fetch?: typeof globalThis.fetch;
  WebSocket?: typeof globalThis.WebSocket;
  XMLHttpRequest?: typeof globalThis.XMLHttpRequest;
}

const GRANT_REFRESH_SKEW_MS = 30_000;

/**
 * Read the body ONCE, then decide whether it was JSON. `response.json()` on a
 * non-JSON error consumed the body and left us with nothing to report, which is
 * how an intermediary's plain-text failure reached the UI as a bare number.
 */
async function readBody(response: Response): Promise<{ data: unknown; text: string }> {
  const text = await response.text().catch(() => "");
  if (!text) return { data: {}, text: "" };
  try {
    return { data: JSON.parse(text) as unknown, text };
  } catch {
    return { data: {}, text };
  }
}

/**
 * A failed request, with the parts a caller may need to BRANCH on kept intact.
 *
 * Every failure used to arrive as a bare `new Error(message)`, which meant the
 * only thing a caller could do with it was print it. Anything that wanted to
 * react — retry a 409, hand a plan refusal to a host's upgrade surface instead
 * of a red toast — had no choice but to regex the prose, which silently breaks
 * the next time that copy is edited.
 *
 * Still an ordinary Error with the same `message`, so every existing
 * `instanceof Error` / `err.message` path is unaffected.
 */
export class OmgApiError extends Error {
  readonly status: number;
  /** Machine-readable tag the server chose to attach (e.g. "plan_limit"). */
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "OmgApiError";
    this.status = status;
    this.code = code;
  }
}

function errorCode(data: unknown): string | undefined {
  return data && typeof data === "object" && "code" in data && typeof data.code === "string"
    ? data.code
    : undefined;
}

function apiError(
  response: Response,
  method: string,
  path: string,
  data: unknown,
  text: string,
): Error {
  // lfg's own routes answer with { error }, and that copy is written for the
  // person reading it — pass it through untouched.
  if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
    return new OmgApiError(data.error, response.status, errorCode(data));
  }
  // Anything else failed somewhere between here and lfg — a proxy, an edge, a
  // tunnel. `${status} ${statusText}` used to be the whole message, and HTTP/2
  // never sends statusText, so it rendered as a naked "405" with no way to tell
  // which request produced it. Name the request and quote whatever body came
  // back so the next one identifies itself.
  const detail = [response.statusText.trim(), text.trim().replace(/\s+/g, " ").slice(0, 200)]
    .filter(Boolean)
    .join(": ");
  return new OmgApiError(
    `${method} ${path} failed (${response.status}${detail ? ` ${detail}` : ""})`,
    response.status,
    errorCode(data),
  );
}

function requestMethod(init: RequestInit | undefined): string {
  return (init?.method ?? "GET").toUpperCase();
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function normalizedPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function socketUrl(baseUrl: string, path: string): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${normalizedPath(path)}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function responseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return headers;
}

function uploadWithXhr(
  XMLHttpRequestImpl: typeof globalThis.XMLHttpRequest,
  url: string,
  init: RequestInit,
  onProgress: (progress: OmgUploadProgress) => void,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequestImpl();
    const signal = init.signal;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => request.abort();

    request.open(requestMethod(init), url, true);
    for (const [name, value] of new Headers(init.headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.addEventListener("progress", (event) => {
      onProgress({
        loaded: event.loaded,
        total: event.total,
        lengthComputable: event.lengthComputable,
      });
    });
    request.addEventListener("load", () => {
      finish(() => {
        resolve(
          new Response(request.responseText, {
            status: request.status,
            statusText: request.statusText,
            headers: responseHeaders(request.getAllResponseHeaders()),
          }),
        );
      });
    });
    request.addEventListener("error", () => {
      finish(() => reject(new Error("Upload failed due to a network error")));
    });
    request.addEventListener("abort", () => {
      finish(() => reject(new DOMException("Upload cancelled", "AbortError")));
    });

    if (signal?.aborted) {
      finish(() => reject(new DOMException("Upload cancelled", "AbortError")));
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    request.send(init.body as XMLHttpRequestBodyInit | Document | null | undefined);
  });
}

export function createSameOriginTransport(
  input: {
    fetch?: typeof globalThis.fetch;
    WebSocket?: typeof globalThis.WebSocket;
    XMLHttpRequest?: typeof globalThis.XMLHttpRequest;
    /**
     * A path prefix put in front of every request, socket and asset path.
     *
     * A self-hosted `omg serve` reaches the account's other machines through
     * its own proxy at `/api/cloud/machines/<id>`, on the same origin the UI
     * was served from. Prefixing here is what lets the whole app switch
     * machines by swapping one transport, with no other code aware of it.
     */
    basePath?: string;
  } = {},
): OmgTransport {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const WebSocketImpl = input.WebSocket ?? globalThis.WebSocket;
  const XMLHttpRequestImpl = input.XMLHttpRequest ?? globalThis.XMLHttpRequest;
  const basePath = (input.basePath ?? "").replace(/\/+$/, "");
  const prefixed = (path: string) => `${basePath}${normalizedPath(path)}`;
  const openSocket = async (path: string): Promise<OmgSocket> => {
    const protocol = globalThis.location?.protocol === "https:" ? "wss:" : "ws:";
    return new WebSocketImpl(
      `${protocol}//${globalThis.location.host}${prefixed(path)}`,
    ) as OmgSocket;
  };
  return {
    fetch(path: string, init?: RequestInit): Promise<Response> {
      return fetchImpl(prefixed(path), init);
    },
    // Same origin, same cookies: the element can fetch this itself.
    assetUrl(path: string): string {
      return prefixed(path);
    },
    async resolveAssetUrl(path: string): Promise<string> {
      return prefixed(path);
    },
    ...(XMLHttpRequestImpl
      ? {
          upload(
            path: string,
            init: RequestInit,
            onProgress: (progress: OmgUploadProgress) => void,
          ): Promise<Response> {
            return uploadWithXhr(XMLHttpRequestImpl, prefixed(path), init, onProgress);
          },
        }
      : {}),
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      const response = await fetchImpl(prefixed(path), init);
      const { data, text } = await readBody(response);
      if (!response.ok) throw apiError(response, requestMethod(init), path, data, text);
      return data as T;
    },
    openSocket,
    openLiveSocket: (query?: string) =>
      openSocket(query ? `/api/live/ws?${query}` : "/api/live/ws"),
  };
}

export function createGrantTransport(options: CreateGrantTransportOptions): OmgTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
  const XMLHttpRequestImpl = options.XMLHttpRequest ?? globalThis.XMLHttpRequest;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const originFor = (current: OmgGrant) => {
    if (!current.sessionOrigin) return baseUrl;
    const origin = new URL(current.sessionOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Invalid session origin");
    return origin.origin;
  };
  let cached: OmgGrant | null = null;
  let refreshRoute = false;

  const grant = async (forceRefresh = false) => {
    forceRefresh ||= refreshRoute;
    if (
      !forceRefresh &&
      cached &&
      cached.expiresAt - Date.now() > GRANT_REFRESH_SKEW_MS
    ) {
      return cached;
    }
    cached = await options.getGrant({ forceRefresh });
    refreshRoute = false;
    return cached;
  };

  const authenticatedFetch = async (
    path: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    const execute = async (forceRefresh: boolean) => {
      const current = await grant(forceRefresh);
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${current.token}`);
      try {
        return await fetchImpl(`${originFor(current)}${path}`, {
          ...init, headers, mode: "cors", credentials: "omit",
        });
      } catch (error) {
        // Refresh the route on the next attempt. Never replay a mutation after
        // a network error: the old gateway may already have applied it.
        refreshRoute = true;
        throw error;
      }
    };
    let response = await execute(false);
    if (response.status === 401) response = await execute(true);
    return response;
  };

  const authenticatedUpload = XMLHttpRequestImpl
    ? async (
        path: string,
        init: RequestInit,
        onProgress: (progress: OmgUploadProgress) => void,
      ): Promise<Response> => {
        const execute = async (forceRefresh: boolean) => {
          const current = await grant(forceRefresh);
          const headers = new Headers(init.headers);
          headers.set("Authorization", `Bearer ${current.token}`);
          return uploadWithXhr(
            XMLHttpRequestImpl,
            `${originFor(current)}${path}`,
            { ...init, headers },
            onProgress,
          );
        };
        let response = await execute(false);
        if (response.status === 401) response = await execute(true);
        return response;
      }
    : null;

  const openSocket = async (path: string): Promise<OmgSocket> => {
    const current = await grant(false);
    const socket = new WebSocketImpl(
      socketUrl(originFor(current), path),
      [`lfg-bearer.${current.token}`],
    ) as OmgSocket;
    // A screen leaving the foreground is not evidence that the route failed.
    // Keep valid grants across local disposal; remote closes and errors still
    // rediscover the route. An explicit reconnect (4000) also refreshes it.
    let locallyClosed = false;
    const close = socket.close.bind(socket);
    socket.close = (code?: number, reason?: string) => {
      locallyClosed = code === undefined || code === 1000;
      if (!locallyClosed) refreshRoute = true;
      close(code, reason);
    };
    socket.addEventListener("error", () => { refreshRoute = true; });
    socket.addEventListener("close", () => { if (!locallyClosed) refreshRoute = true; });
    return socket;
  };

  return {
    fetch: authenticatedFetch,
    ...(authenticatedUpload ? { upload: authenticatedUpload } : {}),
    // Deliberately null. Every request here carries a short-lived bearer grant,
    // and an `<img src>` cannot carry a header. Callers fall back to the blob.
    assetUrl: () => null,
    async resolveAssetUrl(path: string): Promise<string> {
      const current = await grant(false);
      // Keep the credential on the configured session origin even if a buggy
      // caller hands this boundary an absolute URL.
      const url = new URL(`${originFor(current)}${normalizedPath(path)}`);
      url.searchParams.set("__omg_grant", current.token);
      return url.toString();
    },
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const response = await authenticatedFetch(path, init);
      const { data, text } = await readBody(response);
      if (!response.ok) throw apiError(response, requestMethod(init), path, data, text);
      return data as T;
    },
    openSocket,
    openLiveSocket: (query?: string) =>
      openSocket(query ? `/api/live/ws?${query}` : "/api/live/ws"),
  };
}

export type OmgConnectionStatus = RealtimeState["status"];
export type OmgConnectionState = RealtimeState;
export type OmgLiveEnvironment = RealtimeEnvironment;

export interface OmgLiveConnectionOptions {
  capabilities?: OmgLiveCapabilities;
  /**
   * Query for each socket open, read at connect time (for example
   * `user=<identity>` for typing presence on an unmanaged box). A change
   * takes effect on the next connection; call reconnectNow() to apply it.
   */
  socketQuery?: () => string | undefined;
  /** Default: the browser's, when there is one. `null`: none. */
  environment?: OmgLiveEnvironment | null;
  /**
   * Diagnostics: `open` {reconnects}, `reconnect` {attempt, backoffMs, code,
   * reason}, `visibility_probe_timeout` {elapsedMs}. Never throws into the
   * connection.
   */
  onEvent?: (event: string, fields: Record<string, unknown>) => void;
  timing?: {
    backoffMinMs?: number;
    backoffMaxMs?: number;
    /** Ping this often while live to report `latencyMs`. Default 0: off. */
    latencyIntervalMs?: number;
    visibilityProbeTimeoutMs?: number;
  };
}

// Comfortably inside the server's 6 s typing lifetime, far above a keystroke rate.
const TYPING_PING_MS = 2_500;

type TranscriptListener = (event: OmgTranscriptEvent) => void;
type StatusListener = (rows: OmgStatusRow[]) => void;
type ConnectionListener = (state: OmgConnectionState) => void;
type ChangeListener = (topics: OmgChangeTopic[]) => void;

function channelId(channel: OmgLiveChannel): string {
  return `${channel.kind}:${channel.key}`;
}

/** The capability fields of a subscribe frame. Absent means not declared. */
function subscribeCapabilities(capabilities: OmgLiveCapabilities): Record<string, true> {
  const out: Record<string, true> = {};
  if (capabilities.workRows) out.workRows = true;
  if (capabilities.deferToolArgs) out.deferToolArgs = true;
  return out;
}

/** The same capabilities as query parameters, for an HTTP page. */
function capabilityQuery(capabilities: OmgLiveCapabilities): string {
  let query = "";
  if (capabilities.workRows) query += "&workRows=1";
  if (capabilities.deferToolArgs) query += "&deferToolArgs=1";
  return query;
}

export class OmgLiveConnection {
  private readonly connection: RealtimeConnection;
  private listeners = new Map<string, Set<TranscriptListener>>();
  private statusListeners = new Set<StatusListener>();
  private cursors = new Map<string, number>();
  private sentChannels = new Set<string>();
  private pendingFlush = false;
  private connectionListeners = new Set<ConnectionListener>();
  private changeListeners = new Set<ChangeListener>();
  private changesAnnounced = false;
  private readonly capabilities: OmgLiveCapabilities;
  /** Listeners that hear a session's events without subscribing it. */
  private passiveListeners = new Map<string, Set<TranscriptListener>>();
  /** The last send queue per session, replayed to a new listener. */
  private queues = new Map<string, OmgQueueMessage[]>();
  private typingSentAt = new Map<string, number>();
  /** Per session, the drafts in flight by draft id; see OmgDraft. */
  private drafts = new Map<string, Map<string, OmgDraft>>();

  /**
   * `capabilities` are declared on every subscribe frame this connection
   * sends, whatever transport opened the socket. That is the point of
   * putting them here: a client that declares them once cannot opt in on one
   * transport and miss the other.
   */
  /** Only `openLiveSocket` is used, so a caller can supply just that. */
  constructor(
    private readonly transport: Pick<OmgTransport, "openLiveSocket">,
    options: OmgLiveConnectionOptions = {},
  ) {
    this.capabilities = options.capabilities ?? {};
    this.connection = new RealtimeConnection({
      openSocket: () => transport.openLiveSocket(options.socketQuery?.()),
      environment: options.environment,
      onEvent: options.onEvent,
      timing: options.timing,
      heartbeat: {
        ping: id => ({ t: "ping", id }),
        pongId: message => {
          const frame = message as { t?: string; id?: string } | null;
          return frame?.t === "pong" ? frame.id : undefined;
        },
      },
      onOpen: () => {
        this.sentChannels.clear();
        this.scheduleSubscriptionFlush();
      },
      onDisconnect: () => {
        this.changesAnnounced = false;
        this.sentChannels.clear();
      },
      onState: state => {
        for (const listener of this.connectionListeners) {
          try { listener(state); } catch { /* Isolate observers. */ }
        }
      },
      onMessage: message => this.handleMessage(message as OmgLiveMessage),
    });
  }

  get state(): OmgConnectionState {
    return this.connection.state;
  }

  subscribeConnection(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    listener(this.connection.state);
    return () => this.connectionListeners.delete(listener);
  }

  /** Fleet status shares the transcript socket and stays open while observed. */
  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    this.ensureConnected();
    this.scheduleSubscriptionFlush();
    return () => {
      this.statusListeners.delete(listener);
      if (this.statusListeners.size) return;
      if (this.sentChannels.delete("status:*")) {
        this.send({ t: "unsubscribe", channels: [{ kind: "status", key: "*" }] });
      }
      if (!this.hasSubscribers()) this.closeSocket();
    };
  }

  /**
   * The server's list changes (`changed` frames). An empty list means the
   * socket just opened: changes made while it was closed were not sent, so a
   * listener re-reads what it shows. Keeps the socket open while observed.
   */
  subscribeChanges(listener: ChangeListener): () => void {
    this.changeListeners.add(listener);
    this.ensureConnected();
    return () => {
      this.changeListeners.delete(listener);
      if (!this.hasSubscribers()) this.closeSocket();
    };
  }

  /**
   * True while the socket is open and its server has said it announces list
   * changes. While it holds, a list can rely on `changed` frames and poll only
   * as a slow backstop. An older server never says so.
   */
  get announcesChanges(): boolean {
    return this.changesAnnounced;
  }

  private hasSubscribers(): boolean {
    return this.listeners.size > 0 || this.statusListeners.size > 0 || this.changeListeners.size > 0;
  }

  /**
   * Hear a session's events. `passive` listens without holding a
   * subscription: the listener hears whatever the socket already streams for
   * the session because something else subscribed it, and nothing when
   * nothing did. A plain subscription pulls the full backlog snapshot, which
   * a watcher that only wants to know that something arrived does not need.
   */
  subscribeTranscript(
    sessionId: string,
    listener: TranscriptListener,
    options: { passive?: boolean } = {},
  ): () => void {
    const queue = this.queues.get(sessionId);
    if (options.passive) {
      const passive = this.passiveListeners.get(sessionId) ?? new Set<TranscriptListener>();
      passive.add(listener);
      this.passiveListeners.set(sessionId, passive);
      if (queue) listener({ type: "queue", queue });
      return () => {
        const current = this.passiveListeners.get(sessionId);
        current?.delete(listener);
        if (current && !current.size) this.passiveListeners.delete(sessionId);
      };
    }
    const listeners = this.listeners.get(sessionId) ?? new Set<TranscriptListener>();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    if (queue) listener({ type: "queue", queue });
    this.ensureConnected();
    this.scheduleSubscriptionFlush();
    return () => {
      const current = this.listeners.get(sessionId);
      if (!current) return;
      current.delete(listener);
      if (current.size) return;
      this.listeners.delete(sessionId);
      this.cursors.delete(channelId({ kind: "transcript", key: sessionId }));
      if (this.sentChannels.delete(`transcript:${sessionId}`)) {
        this.send({
          t: "unsubscribe",
          channels: [{ kind: "transcript", key: sessionId }],
        });
      }
      if (!this.hasSubscribers()) this.closeSocket();
    };
  }

  /**
   * Retry at once. `force` (the default) also replaces a live socket, which
   * refreshes a grant route. `force: false` only cuts the wait: a live or
   * opening socket is kept.
   */
  reconnectNow(options: { force?: boolean } = {}): void {
    this.connection.reconnect(options);
  }

  dispose(): void {
    this.changeListeners.clear();
    this.changesAnnounced = false;
    this.listeners.clear();
    this.passiveListeners.clear();
    this.queues.clear();
    this.statusListeners.clear();
    this.connectionListeners.clear();
    this.connection.dispose();
  }

  private ensureConnected(): void {
    if (this.hasSubscribers()) this.connection.connect();
  }

  private closeSocket(): void { this.connection.disconnect(); }

  private scheduleSubscriptionFlush(): void {
    if (this.pendingFlush) return;
    this.pendingFlush = true;
    queueMicrotask(() => {
      this.pendingFlush = false;
      if (!this.connection.isOpen) return;
      const channels: OmgLiveChannel[] = [];
      for (const sessionId of this.listeners.keys()) {
        if (this.sentChannels.has(`transcript:${sessionId}`)) continue;
        const channel: OmgLiveChannel = { kind: "transcript", key: sessionId };
        const cursor = this.cursors.get(channelId(channel));
        if (cursor) channel.resumeFromSeq = cursor;
        channels.push(channel);
        this.sentChannels.add(`transcript:${sessionId}`);
      }
      if (this.statusListeners.size && !this.sentChannels.has("status:*")) {
        channels.push({ kind: "status", key: "*" });
        this.sentChannels.add("status:*");
      }
      if (channels.length) this.send({ t: "subscribe", channels, ...subscribeCapabilities(this.capabilities) });
    });
  }

  private send(payload: unknown): boolean { return this.connection.send(payload); }

  // The wire carries deltas; a client wants the text. A part with `reset` (or
  // a `text-start`) restarts its draft, a `text-delta` extends it, and the
  // draft's `kind` is the part's, defaulting to a reply for servers that
  // predate the field. Reasoning and reply keep separate drafts even when
  // they share an id.
  private accumulateDraft(sessionId: string, part: OmgAiStreamPart): OmgDraft | null {
    if (!part.id) return null;
    if (part.type !== "text-delta" && part.type !== "text-start") return null;
    const kind: OmgDraft["kind"] = part.kind === "thinking" ? "thinking" : "text";
    const key = `${kind}:${part.id}`;
    let bySession = this.drafts.get(sessionId);
    if (!bySession) {
      bySession = new Map();
      this.drafts.set(sessionId, bySession);
    }
    const previous = bySession.get(key);
    const restart = part.type === "text-start" || !!part.reset || !previous;
    const text = restart ? (part.text ?? part.delta ?? "") : `${previous!.text}${part.delta ?? ""}`;
    const draft: OmgDraft = { id: part.id, kind, text, ...(part.ts != null ? { ts: part.ts } : {}) };
    bySession.set(key, draft);
    return draft;
  }

  /**
   * Tell the session's other viewers whether this one is typing. Call it on
   * every keystroke: a "still typing" frame goes out at most every 2.5 s
   * (inside the server's typing lifetime), the start and stop edges at once.
   */
  sendTyping(sessionId: string, typing: boolean): void {
    if (!sessionId) return;
    const now = Date.now();
    if (typing && now - (this.typingSentAt.get(sessionId) ?? 0) < TYPING_PING_MS) return;
    this.typingSentAt.set(sessionId, typing ? now : 0);
    this.send({ t: "typing", sid: sessionId, typing });
  }

  private emit(sessionId: string, event: OmgTranscriptEvent): void {
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event);
    for (const listener of this.passiveListeners.get(sessionId) ?? []) listener(event);
  }

  private handleMessage(message: OmgLiveMessage): void {
    if (message.t === "changed") {
      this.changesAnnounced = true;
      const topics = Array.isArray(message.topics) ? message.topics : [];
      for (const listener of this.changeListeners) {
        try {
          listener(topics);
        } catch {
          // One listener's failure must not stop the others.
        }
      }
      return;
    }
    if (message.t === "status") {
      if (Array.isArray(message.rows)) {
        for (const listener of this.statusListeners) listener(message.rows);
      }
      return;
    }
    if (message.t === "ping") {
      this.send({ t: "pong", ...(message.id ? { id: message.id } : {}) });
      return;
    }
    if (message.t === "pong") return;
    if (
      "kind" in message &&
      message.kind === "transcript" &&
      "key" in message &&
      typeof message.key === "string"
    ) {
      const id = channelId({ kind: message.kind, key: message.key });
      if (typeof message.seq === "number") {
        const previous = this.cursors.get(id) ?? 0;
        const resync =
          message.t === "snapshot" ||
          message.t === "gap" ||
          message.t === "resumed";
        if (!resync && message.seq <= previous) return;
        this.cursors.set(id, message.seq);
      }
      if (message.t === "snapshot") {
        this.emit(message.key, {
          type: "snapshot",
          messages: message.messages ?? [],
          nextBefore: message.nextBefore ?? null,
        });
        return;
      }
      if (message.t === "delta" && message.delta?.t) {
        this.handleMessage({
          ...message.delta,
          t: message.delta.t,
          sid: message.delta.sid ?? message.key,
        } as OmgLiveMessage);
        return;
      }
      if (message.t === "error") {
        this.emit(message.key, {
          type: "error",
          error: message.message ?? message.code ?? "Live connection error",
        });
      }
      return;
    }
    const sessionId = "sid" in message ? message.sid : undefined;
    if (!sessionId) return;
    if (message.t === "batch") {
      this.emit(sessionId, {
        type: "snapshot",
        messages: message.messages ?? [],
        nextBefore: message.nextBefore ?? null,
      });
    } else if (message.t === "msg") {
      const item = message.message ?? message.m;
      if (item) this.emit(sessionId, { type: "message", message: item });
    } else if (message.t === "ai_part" && message.part) {
      this.emit(sessionId, { type: "ai_part", part: message.part });
      const draft = this.accumulateDraft(sessionId, message.part);
      if (draft) this.emit(sessionId, { type: "draft", draft });
    } else if (message.t === "busy") {
      // The turn is over: nothing is being drafted any more.
      if (!message.busy) this.drafts.delete(sessionId);
      this.emit(sessionId, { type: "busy", busy: !!message.busy });
    } else if (message.t === "prompt") {
      this.emit(sessionId, {
        type: "prompt",
        prompt: message.prompt ?? null,
      });
    } else if (message.t === "queue") {
      const queue = Array.isArray(message.queue) ? message.queue : [];
      this.queues.set(sessionId, queue);
      this.emit(sessionId, { type: "queue", queue });
    } else if (message.t === "typing") {
      // Replace, never merge: the frame is the current set.
      this.emit(sessionId, { type: "typing", ids: Array.isArray(message.ids) ? message.ids : [] });
    } else if (message.t === "error") {
      this.emit(sessionId, {
        type: "error",
        error: message.message ?? message.code ?? "Live connection error",
      });
    }
  }
}

export class OmgClient {
  readonly live: OmgLiveConnection;
  private sessions: OmgSession[] | null = null;
  private readonly capabilities: OmgLiveCapabilities;

  /**
   * `capabilities` apply to the live socket AND to `getMessages`, so history
   * and the live stream arrive in one shape. See OmgLiveCapabilities.
   */
  constructor(
    readonly transport: OmgTransport,
    options: OmgLiveConnectionOptions = {},
  ) {
    this.capabilities = options.capabilities ?? {};
    this.live = new OmgLiveConnection(transport, { ...options, capabilities: this.capabilities });
  }

  peekSessions(): OmgSession[] | null {
    return this.sessions;
  }

  async listSessions(): Promise<OmgSession[]> {
    const response = await this.transport.request<OmgSessionsResponse>("/api/sessions", {
      cache: "no-store",
    });
    this.sessions = Array.isArray(response.sessions) ? response.sessions : [];
    return this.sessions;
  }

  // A general fallback for callers that don't pass a limit — not a mirror of
  // any particular screen's tuning. mobile/app/session/[id].tsx, for one,
  // always passes its own `limit` (currently 40, sized for that screen's
  // initial-render cost) rather than relying on this default; the two are
  // intentionally allowed to differ.
  async getMessages(sessionId: string, limit = 80): Promise<OmgMessagesResponse> {
    return this.transport.request<OmgMessagesResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}${capabilityQuery(this.capabilities)}`,
      { cache: "no-store" },
    );
  }

  async sendMessage(sessionId: string, text: string): Promise<OmgSendResponse> {
    return this.transport.request<OmgSendResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      },
    );
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.transport.request(
      `/api/sessions/${encodeURIComponent(sessionId)}/interrupt`,
      { method: "POST" },
    );
  }

  dispose(): void {
    this.live.dispose();
  }
}

// Compatibility names for existing Computer clients. The SDK owns view reads,
// invalidation coalescing and cleanup as well as the socket lifecycle.
export { liveCollection } from "@omg-dev/sdk/realtime";
export type {
  RealtimeCollection as OmgLiveCollection,
  RealtimeCollectionOptions as OmgLiveCollectionOptions,
} from "@omg-dev/sdk/realtime";
export type OmgChangeSource = import("@omg-dev/sdk/realtime").RealtimeChangeSource<OmgChangeTopic>;
