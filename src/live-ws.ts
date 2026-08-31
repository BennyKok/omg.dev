import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import type { ServerWebSocket } from "bun";
import { PATHS } from "./config.ts";
import {
  resolveTranscript,
  pendingToolPrompt,
  deferToolUseArgs,
  visibleTranscriptMessages,
  type PendingPrompt,
  type Session,
} from "./sessions.ts";
import { listSessionsCached, noteListSessionsClientActivity } from "./session-cache.ts";
import {
  indexedMessageRowPage,
  indexedMessagesAfterRowid,
  isSessionIndexKey,
  subscribeIndexedArtifactMessages,
} from "./transcript-index.ts";
import { countTranscriptRows } from "./transcript-rows.ts";
import { ensureChatTranscriptCaughtUp, subscribeChatTranscript } from "./chat-ingest.ts";
import {
  capturePane,
  parsePrompt,
  isBusy,
  isJcodeBusy,
  type PanePrompt,
} from "./tmux.ts";
import {
  findEntryByAnyId,
  isEntryBusy as isAisdkEntryBusy,
} from "./aisdk-registry.ts";
import {
  collapseArtifactRetryMessages,
  hydrateImageArtifactMessage,
  type ImageArtifactMessage,
} from "./artifacts.ts";
import { listQueue, reconcileQueued } from "./sendq.ts";
import { traceLog } from "./trace-log.ts";

/**
 * `participantId` is the conversation participant this socket may speak as,
 * resolved once at upgrade from the same verified viewer identity the send
 * path uses. It is null on an unmanaged box, where no trusted multi-user
 * identity exists — such a socket can read presence but can never claim to be
 * typing, because there is nobody to attribute the claim to.
 */
export type LiveWsSocketData = { liveWs: true; rid: string; participantId: string | null };

type Evlog = (event: string, fields?: Record<string, unknown>) => void;
type LiveWs = ServerWebSocket<unknown>;
type SendType = "batch" | "msg" | "busy" | "prompt" | "queue" | "ai_part" | "error";
type DraftState = { id: string; text: string; kind: "text" | "thinking" };
type HtmlMessage = {
  kind: string;
  text: string;
  html?: string;
  id?: string | null;
  ts?: number | null;
  artifactId?: string;
  url?: string;
  name?: string;
  size?: number;
};
type LivePane = { sid: string; tp: string | null; target: string | null; agent: Session["agent"] | null };
type ChannelKind = "transcript" | "status" | "agent_run";
type Channel = { kind: ChannelKind; key: string; resumeFromSeq?: number };
type AgentRunSnapshot = {
  id: string;
  agent: string;
  date?: string;
  status: "running" | "done" | "failed";
  logs: string[];
  result?: unknown;
  error?: string;
};
type AgentRunEvent =
  | { type: "log"; line: string }
  | { type: "done" | "failed"; status: "done" | "failed"; result?: unknown; error?: string };

const EVLOG_DIR = join(PATHS.data, "evlogs");
const SID_RE = /^[0-9a-fA-F-]{36}$/;
const RUN_RE = /^[0-9a-f]+$/;
const SUBSCRIPTION_CAP = 48;
const BACKLOG_LIMIT = 40;
// The backlog is measured in rendered rows, not raw messages: the client folds
// each run of tool_use / tool_result / thinking into one row, so 40 raw
// messages were two rows on a tool-heavy session.
const BACKLOG_ROWS = 24;
// Ceiling for the same backlog in raw messages: one socket carries a backlog
// per subscribed session, so the first frame stays small.
const BACKLOG_MAX_MESSAGES = 400;
const HEARTBEAT_MS = 25_000;
const IDLE_CLOSE_MS = 60_000;
const RING_CAP = 256;
// A typing claim expires on its own, so a client that closes its laptop mid
// word cannot leave an indicator up forever. The client re-asserts well inside
// this window while keys are actually being pressed.
const TYPING_TTL_MS = 6_000;
const TYPING_SWEEP_MS = 2_000;
const LIVE_DB_POLL_LIMIT = 500;

const messageHtmlCache = new Map<string, string>();
const MESSAGE_HTML_CACHE_MAX = 4_000;

function defaultEvlog(event: string, fields: Record<string, unknown> = {}) {
  traceLog(event, fields);
  try {
    mkdirSync(EVLOG_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(
      join(EVLOG_DIR, `${day}.jsonl`),
      `${JSON.stringify({
        ts: new Date().toISOString(),
        monoMs: Math.round(performance.now() * 1000) / 1000,
        event,
        ...fields,
      })}\n`,
    );
  } catch {}
}

export function liveTransportMode(): "sse" | "ws" {
  return process.env.LIVE_TRANSPORT === "sse" ? "sse" : "ws";
}

export function isLiveWsEnabled(): boolean {
  return liveTransportMode() === "ws";
}

function safeSend(ws: LiveWs, payload: unknown): boolean {
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

// The `deferToolArgs` capability on a fan-out transport.
//
// A websocket frame is built ONCE and sent to every socket subscribed to the
// channel, and the resume ring keeps that one frame under one seq. The
// capability, though, belongs to the socket: two clients on the same session
// can disagree about it, and one of them may be a pinned older build.
//
// So the builders and the ring keep the FULL frame, which stays the canonical
// record, and the capability is applied here, on the way out to one socket.
// The transformed copy is cached against the frame it came from, so a frame
// going to twenty capable sockets is transformed once, not twenty times.
const deferredFrames = new WeakMap<Record<string, unknown>, Record<string, unknown>>();

function deferMessageField(container: Record<string, unknown>, field: string): boolean {
  const value = container[field];
  if (!value || typeof value !== "object") return false;
  container[field] = deferToolUseArgs([value as { kind: string; text: string }])[0];
  return true;
}

export function deferToolArgsInFrame(frame: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...frame };
  // Snapshot and batch frames carry a list.
  if (Array.isArray(next.messages)) {
    next.messages = deferToolUseArgs(next.messages as Array<{ kind: string; text: string }>);
  }
  // A delta wraps the single new message, under `message` or the short `m`.
  const delta = next.delta;
  if (delta && typeof delta === "object") {
    const copy = { ...(delta as Record<string, unknown>) };
    const changed = deferMessageField(copy, "message") || deferMessageField(copy, "m");
    if (Array.isArray(copy.messages)) {
      copy.messages = deferToolUseArgs(copy.messages as Array<{ kind: string; text: string }>);
    }
    if (changed || Array.isArray(copy.messages)) next.delta = copy;
  }
  deferMessageField(next, "message");
  deferMessageField(next, "m");
  return next;
}

/** The frame one socket should receive, honouring the capability it declared. */
export function frameForSocket(
  state: { deferToolArgs?: boolean },
  frame: Record<string, unknown>,
): Record<string, unknown> {
  if (!state.deferToolArgs) return frame;
  const cached = deferredFrames.get(frame);
  if (cached) return cached;
  const deferred = deferToolArgsInFrame(frame);
  deferredFrames.set(frame, deferred);
  return deferred;
}

function roundMs(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}

function messageHtmlCacheKey(m: HtmlMessage): string {
  return `${m.id ?? ""}\0${m.kind}\0${m.text.length}\0${m.text.slice(0, 96)}`;
}

function rememberMessageHtml(key: string, html: string) {
  if (messageHtmlCache.has(key)) messageHtmlCache.delete(key);
  messageHtmlCache.set(key, html);
  if (messageHtmlCache.size <= MESSAGE_HTML_CACHE_MAX) return;
  const oldest = messageHtmlCache.keys().next().value;
  if (oldest) messageHtmlCache.delete(oldest);
}

function msgWithHtml<T extends HtmlMessage>(m: T): T & { html?: string } {
  if (m.kind === "text" && m.text) {
    const key = messageHtmlCacheKey(m);
    const cached = messageHtmlCache.get(key);
    if (cached !== undefined) return { ...m, html: cached };
    const html = marked.parse(m.text) as string;
    rememberMessageHtml(key, html);
    return { ...m, html };
  }
  return m;
}

function artifactIdFromUrl(url?: string): string | null {
  if (!url) return null;
  const match = url.match(/\/api\/artifacts\/([^/?#]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function mediaIdentity(message: { kind?: string; id?: string | null; artifactId?: string; url?: string; ts?: number | null; name?: string; size?: number; text?: string }): string | null {
  if (message.kind !== "image" && message.kind !== "video") return message.id ?? null;
  const artifactId = message.artifactId || artifactIdFromUrl(message.url);
  if (artifactId) return `artifact-${artifactId}`;
  if (message.url) return `media-${message.kind}-${message.url}`;
  if (message.id) return message.id;
  return `media-${message.kind}-${message.ts ?? "no-ts"}-${message.name ?? ""}-${message.size ?? ""}-${message.text ?? ""}`;
}

function normalizeMediaIdentity<T extends { kind: string; id?: string | null; artifactId?: string; url?: string; ts?: number | null; name?: string; size?: number; text?: string }>(message: T): T {
  const id = mediaIdentity(message);
  if (!id || id === message.id) return message;
  return { ...message, id };
}

function withImageArtifacts<T extends { role: string; kind: string; text: string; ts?: number | null; id?: string | null }>(
  _sessionId: string,
  messages: T[],
): Array<T | ImageArtifactMessage> {
  return collapseArtifactRetryMessages(
    messages.map((message) =>
      normalizeMediaIdentity(hydrateImageArtifactMessage(message as unknown as import("./sessions.ts").SessionMsg)) as T | ImageArtifactMessage
    ),
  );
}

function transcriptMessagesForClient<T extends { role: string; kind: string; text: string; ts?: number | null; id?: string | null }>(
  sessionId: string,
  messages: T[],
): Array<T | ImageArtifactMessage> {
  return withImageArtifacts(sessionId, visibleTranscriptMessages(messages));
}

async function resolveSessionPrompt(
  tp: string | null,
  pane: string | null,
): Promise<PanePrompt | PendingPrompt | null> {
  if (tp) {
    const pending = await pendingToolPrompt(tp);
    if (pending) return pending;
  }
  return pane ? parsePrompt(pane) : null;
}

function sendAiTextDeltaPart(
  emit: (type: SendType, fields: Record<string, unknown>) => void,
  sid: string,
  entry: {
    sessionId: string;
    draftText?: string | null;
    draftKind?: "text" | "thinking" | null;
    draftUpdatedAt?: number | null;
  },
  lastDraft: Map<string, DraftState>,
): void {
  const id = `draft-${entry.sessionId}`;
  const text = entry.draftText ?? "";
  const kind = entry.draftKind ?? "text";
  const prev = lastDraft.get(sid);
  if (!text) {
    if (prev) lastDraft.delete(sid);
    return;
  }
  let part: { type: "text-delta"; id: string; kind: "text" | "thinking"; delta?: string; text?: string; reset?: boolean; ts: number };
  if (!prev || prev.id !== id || prev.kind !== kind || !text.startsWith(prev.text)) {
    part = { type: "text-delta", id, kind, text, reset: true, ts: entry.draftUpdatedAt ?? Date.now() };
  } else {
    const delta = text.slice(prev.text.length);
    if (!delta) return;
    part = { type: "text-delta", id, kind, delta, ts: entry.draftUpdatedAt ?? Date.now() };
  }
  lastDraft.set(sid, { id, text, kind });
  emit("ai_part", { part });
}

function slimStatus(s: Session) {
  return {
    sessionId: s.sessionId,
    busy: !!s.busy,
    title: s.title ?? null,
    lastUserText: s.lastUserText ?? null,
    lastActivityAt: s.lastActivityAt ?? null,
    status: s.status ?? "ok",
    statusReason: s.statusReason ?? null,
    statusDetail: s.statusDetail ?? null,
    model: s.model ?? null,
  };
}

type SocketState = {
  ws: LiveWs;
  rid: string;
  subscribed: Set<string>;
  closed: boolean;
  lastTraffic: number;
  heartbeat: ReturnType<typeof setInterval> | null;
  // Capability declared on a subscribe frame. Latches on: a client either
  // knows how to fetch tool arguments on demand or it does not, and that does
  // not change while the socket is open. Absent means the full inline payload,
  // which is what every client built before the capability existed receives.
  deferToolArgs: boolean;
  /** See LiveWsSocketData. Null means this socket cannot report typing. */
  participantId: string | null;
};

type ChannelState = {
  seq: number;
  ring: Array<{ seq: number; frame: Record<string, unknown> }>;
};

type SidTail = {
  sid: string;
  sockets: Set<LiveWs>;
  pane: LivePane;
  lastSig: string;
  lastBusy: string;
  lastQ: string;
  lastMessageAt: number;
  lastStallLogAt: number;
  lastDraft: Map<string, DraftState>;
  pollInterval: ReturnType<typeof setInterval> | null;
  draftInterval: ReturnType<typeof setInterval> | null;
  transcriptUnsub: (() => void) | null;
  transcriptSource: "file" | "db" | null;
  transcriptDbRowid: number | null;
  transcriptDbSessionId: string | null;
  transcriptDbPolling: boolean;
};

// Live view of the active support instance's sid tails, so out-of-band callers
// can ask "is anyone actually looking at this session right now?". Read through
// a pointer rather than a mirrored Set — a parallel copy would drift the moment
// a socket closed on a path that forgot to update it.
let activeSidTails: Map<string, SidTail> | null = null;

/**
 * True when a live WebSocket is currently subscribed to this session's
 * transcript — i.e. the user has it open. Used to keep push notifications quiet
 * about a session already on screen. Tails are torn down as soon as their last
 * socket goes (see cleanupSidTail), so this can't report a stale yes.
 */
export function isSessionWatched(sid: string): boolean {
  const tail = activeSidTails?.get(sid);
  return !!tail && tail.sockets.size > 0;
}

export function createLiveWsSupport(opts: {
  evlog?: Evlog;
  getAgentRun?: (runId: string) => AgentRunSnapshot | null;
  subscribeAgentRun?: (runId: string, cb: (event: AgentRunEvent) => void) => () => void;
} = {}) {
  const evlog = opts.evlog ?? defaultEvlog;
  const sockets = new WeakMap<LiveWs, SocketState>();
  const sidTails = new Map<string, SidTail>();
  activeSidTails = sidTails;
  const channelStates = new Map<string, ChannelState>();
  const agentRunUnsubs = new Map<string, () => void>();
  const openSockets = new Set<LiveWs>();
  let statusInterval: ReturnType<typeof setInterval> | null = null;
  let lastStatusSig = "";
  let statusPublishing = false;

  const channelId = (channel: Pick<Channel, "kind" | "key">): string => `${channel.kind}:${channel.key}`;
  const transcriptChannel = (sid: string): Channel => ({ kind: "transcript", key: sid });
  const statusChannel = (): Channel => ({ kind: "status", key: "*" });

  const channelFromId = (id: string): Channel | null => {
    const sep = id.indexOf(":");
    if (sep <= 0) return null;
    const kind = id.slice(0, sep) as ChannelKind;
    const key = id.slice(sep + 1);
    if (!key) return null;
    return { kind, key };
  };

  const stateForChannel = (channel: Pick<Channel, "kind" | "key">): ChannelState => {
    const id = channelId(channel);
    let state = channelStates.get(id);
    if (!state) {
      state = { seq: 0, ring: [] };
      channelStates.set(id, state);
    }
    return state;
  };

  const nextSeq = (channel: Pick<Channel, "kind" | "key">): number => {
    const state = stateForChannel(channel);
    state.seq += 1;
    return state.seq;
  };

  const stamp = (channel: Pick<Channel, "kind" | "key">, frame: Record<string, unknown>): Record<string, unknown> => {
    const seq = nextSeq(channel);
    return { ...frame, kind: channel.kind, key: channel.key, seq };
  };

  const rememberDelta = (channel: Pick<Channel, "kind" | "key">, frame: Record<string, unknown>) => {
    const state = stateForChannel(channel);
    const seq = typeof frame.seq === "number" ? frame.seq : state.seq;
    state.ring.push({ seq, frame });
    if (state.ring.length > RING_CAP) state.ring.splice(0, state.ring.length - RING_CAP);
  };

  const publishChannelDelta = (channel: Pick<Channel, "kind" | "key">, delta: Record<string, unknown>) => {
    const frame = stamp(channel, { t: "delta", delta });
    rememberDelta(channel, frame);
    const id = channelId(channel);
    for (const ws of openSockets) {
      const state = sockets.get(ws);
      if (!state || state.closed || !state.subscribed.has(id)) continue;
      safeSend(ws, frameForSocket(state, frame));
    }
  };

  const publishSid = (sid: string, type: SendType, fields: Record<string, unknown>) => {
    publishChannelDelta(transcriptChannel(sid), { t: type, sid, ...fields });
  };

  // ---- who is typing right now -------------------------------------------
  //
  // Deliberately NOT a channel delta. Everything that goes through
  // publishChannelDelta is stamped with a seq and kept in the resume ring, so
  // a client that drops and resumes replays it. Replaying "Ana is typing" from
  // thirty seconds ago would show an indicator for something that already
  // finished, and no later frame would arrive to correct it, because the truth
  // is an absence of frames. Presence is therefore ephemeral and unstamped: it
  // is only ever true right now, and a resuming client learns the current set
  // from the next broadcast or from the TTL expiring it.
  //
  // The wire shape is the FULL set for the session, not a join/leave event.
  // A dropped event in an event stream leaves a stuck indicator forever; a
  // dropped snapshot is corrected by the next one, which is at most
  // TYPING_TTL_MS away.
  // Keyed by SOCKET, not by participant, then reduced to distinct participant
  // ids on the way out. One person with two tabs open holds two claims, so
  // blurring one tab retracts only that tab's claim and their still-active
  // other tab keeps them in the set. Keying by participant would let the blur
  // erase their own live keystrokes elsewhere.
  const typingBySid = new Map<string, Map<LiveWs, { p: string; exp: number }>>();
  let typingSweep: ReturnType<typeof setInterval> | null = null;

  const typingIdsFor = (sid: string): string[] => {
    const row = typingBySid.get(sid);
    if (!row) return [];
    return [...new Set([...row.values()].map((entry) => entry.p))].sort();
  };

  const broadcastTyping = (sid: string) => {
    // Unstamped and unremembered, so it cannot be replayed on resume.
    const frame = { t: "typing", sid, ids: typingIdsFor(sid) };
    const id = channelId(transcriptChannel(sid));
    for (const ws of openSockets) {
      const state = sockets.get(ws);
      if (!state || state.closed || !state.subscribed.has(id)) continue;
      safeSend(ws, frame);
    }
  };

  /**
   * Drop expired claims. Returns the sids whose VISIBLE set changed, which is
   * not the same as the sids that lost a claim: one tab of a two-tab typist
   * expiring leaves the same person still typing, and must not put a frame on
   * the wire.
   */
  const pruneTyping = (now: number): string[] => {
    const changed: string[] = [];
    for (const [sid, row] of [...typingBySid]) {
      const before = typingIdsFor(sid).join(",");
      for (const [ws, entry] of row) {
        if (entry.exp > now) continue;
        row.delete(ws);
      }
      if (row.size === 0) typingBySid.delete(sid);
      if (typingIdsFor(sid).join(",") !== before) changed.push(sid);
    }
    return changed;
  };

  /** Retract every claim a closing socket still holds. */
  const forgetTypingSocket = (ws: LiveWs) => {
    for (const [sid, row] of [...typingBySid]) {
      if (!row.has(ws)) continue;
      const before = typingIdsFor(sid).join(",");
      row.delete(ws);
      if (row.size === 0) typingBySid.delete(sid);
      if (typingIdsFor(sid).join(",") !== before) broadcastTyping(sid);
    }
    stopTypingSweepIfIdle();
  };

  const stopTypingSweepIfIdle = () => {
    if (typingBySid.size || !typingSweep) return;
    clearInterval(typingSweep);
    typingSweep = null;
  };

  const ensureTypingSweep = () => {
    if (typingSweep) return;
    typingSweep = setInterval(() => {
      for (const sid of pruneTyping(Date.now())) broadcastTyping(sid);
      stopTypingSweepIfIdle();
    }, TYPING_SWEEP_MS);
    typingSweep.unref?.();
  };

  /** Record (or retract) one socket's typing claim for one session. */
  const setTyping = (sid: string, ws: LiveWs, participantId: string, typing: boolean) => {
    const before = typingIdsFor(sid).join(",");
    const row = typingBySid.get(sid);
    if (typing) {
      const next = row ?? new Map<LiveWs, { p: string; exp: number }>();
      next.set(ws, { p: participantId, exp: Date.now() + TYPING_TTL_MS });
      typingBySid.set(sid, next);
      ensureTypingSweep();
    } else if (row) {
      row.delete(ws);
      if (row.size === 0) typingBySid.delete(sid);
    }
    // Only tell anyone when the visible set changed. A keystroke heartbeat
    // merely extends an existing expiry, and that is the common case: it must
    // not put a frame on every subscribed socket several times a second.
    if (typingIdsFor(sid).join(",") !== before) broadcastTyping(sid);
  };

  // Artifact publishes fan out only after their SQLite row commits. This is
  // the same ordered source used by snapshots, removing the parallel JSON
  // poller that could show a blank media card ahead of transcript prose.
  subscribeIndexedArtifactMessages(({ sessionId, message }) => {
    const tail = sidTails.get(sessionId);
    if (tail) tail.lastMessageAt = Date.now();
    publishSid(sessionId, "msg", { message: msgWithHtml(normalizeMediaIdentity(message)) });
  });

  const stopStatusLoopIfIdle = () => {
    if (openSockets.size || !statusInterval) return;
    clearInterval(statusInterval);
    statusInterval = null;
    lastStatusSig = "";
  };

  const publishStatus = async () => {
    if (!openSockets.size) return;
    if (statusPublishing) return;
    statusPublishing = true;
    const t0 = performance.now();
    try {
      // The fleet status broadcast tolerates ≤ cache-TTL staleness and must NOT
      // rebuild the full session list (~180ms) on the event loop every second.
      // Keep the shared cache warm while sockets are open, then read the cached
      // snapshot — a single background refresher owns the real listSessions().
      noteListSessionsClientActivity();
      const rows = (await listSessionsCached())
        .filter((s) => s.sessionId)
        .map(slimStatus);
      const sig = JSON.stringify(rows);
      const changed = sig !== lastStatusSig;
      if (changed) {
        lastStatusSig = sig;
        const frame = stamp(statusChannel(), { t: "status", rows });
        for (const ws of openSockets) safeSend(ws, frame);
      }
      evlog("live_status_tick", {
        transport: "ws",
        sessions: rows.length,
        changed,
        durationMs: roundMs(performance.now() - t0),
      });
    } finally {
      statusPublishing = false;
    }
  };

  const ensureStatusLoop = () => {
    if (statusInterval) return;
    void publishStatus();
    statusInterval = setInterval(() => void publishStatus(), 1000);
  };

  /**
   * Give a socket that just connected the fleet as it stands.
   *
   * The status loop only broadcasts when the rows *change*, and it does not
   * restart for a socket that arrives while another one is already connected —
   * so a reconnecting tab could wait for the next real fleet change before it
   * saw any status at all. On a quiet fleet that wait is unbounded, and the
   * list sits stale behind a working socket until the 5s REST poll catches it.
   */
  const sendStatusBaseline = async (ws: LiveWs) => {
    noteListSessionsClientActivity();
    const rows = (await listSessionsCached()).filter((s) => s.sessionId).map(slimStatus);
    safeSend(ws, stamp(statusChannel(), { t: "status", rows }));
  };

  const traceStallIfNeeded = (tail: SidTail, busy: boolean) => {
    const now = Date.now();
    if (!busy) {
      tail.lastMessageAt = now;
      return;
    }
    const idleMs = now - tail.lastMessageAt;
    if (idleMs < 10_000 || now - tail.lastStallLogAt < 10_000) return;
    tail.lastStallLogAt = now;
    evlog("live_stream_stall", {
      transport: "ws",
      sid: tail.sid,
      transcriptPath: tail.pane.tp,
      idleMs,
      subscribers: tail.sockets.size,
    });
  };

  const cleanupSidTail = (sid: string) => {
    const tail = sidTails.get(sid);
    if (!tail || tail.sockets.size) return;
    if (tail.pollInterval) clearInterval(tail.pollInterval);
    if (tail.draftInterval) clearInterval(tail.draftInterval);
    tail.transcriptUnsub?.();
    sidTails.delete(sid);
  };

  const hydrateTarget = async (tail: SidTail) => {
    const all = await listSessionsCached();
    const session = all.find((s) => s.sessionId === tail.sid);
    tail.pane.target = session?.tmuxTarget ?? null;
    tail.pane.agent = session?.agent ?? null;
  };

  const subscribeTailToTranscript = async (tail: SidTail, tp: string) => {
    if (tail.transcriptSource) return;
    const entry = findEntryByAnyId(tail.sid);
    if (entry || isSessionIndexKey(tp)) {
      const sessionId = entry?.sessionId ?? tail.sid;
      const snapshotCursor = indexedMessagesAfterRowid(tp, sessionId, 0, 0);
      tail.transcriptSource = "db";
      tail.transcriptDbRowid = snapshotCursor.maxRowid;
      tail.transcriptDbSessionId = sessionId;
      return;
    }
    tail.transcriptSource = "file";
    tail.transcriptUnsub = subscribeChatTranscript(tp, tail.sid, (event) => {
      const messages = visibleTranscriptMessages(event.messages);
      if (messages.length) tail.lastMessageAt = Date.now();
      for (const message of messages) publishSid(tail.sid, "msg", { message: msgWithHtml(message) });
    });
  };

  const ensureTranscriptSubscription = async (tail: SidTail) => {
    try {
      if (tail.transcriptUnsub) return;
      if (!tail.pane.tp) {
        const tp = await resolveTranscript(tail.sid);
        if (!tp) return;
        tail.pane.tp = tp;
        if (findEntryByAnyId(tail.sid)) {
          await publishCurrentBatch(tail);
          await subscribeTailToTranscript(tail, tp);
          return;
        }
        await subscribeTailToTranscript(tail, tp);
        await publishCurrentBatch(tail);
        return;
      }
      await subscribeTailToTranscript(tail, tail.pane.tp);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== "ENOENT") {
        evlog("ws_transcript_ingest_error", {
          sid: tail.sid,
          transcriptPath: tail.pane.tp,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  const pollIndexedTranscript = async (tail: SidTail) => {
    if (tail.transcriptSource !== "db" || tail.transcriptDbPolling) return;
    // jcode history is journal + session.json merged into the lfg:// index on
    // each resolve. Re-resolve every poll so a rewritten journal still streams
    // new turns and recovered snapshot history without a file tailer.
    if (tail.pane.agent === "jcode") {
      try {
        const refreshed = await resolveTranscript(tail.sid);
        if (refreshed) tail.pane.tp = refreshed;
      } catch {}
    }
    const tp = tail.pane.tp;
    const sessionId = tail.transcriptDbSessionId;
    const afterRowid = tail.transcriptDbRowid;
    if (!tp || !sessionId || afterRowid == null) return;
    tail.transcriptDbPolling = true;
    try {
      let page = indexedMessagesAfterRowid(tp, sessionId, afterRowid, LIVE_DB_POLL_LIMIT);
      // A jcode index rebuild (journal rewrite) reassigns SQLite rowids. If our
      // cursor is now past the max rowid, drop back and republish the snapshot
      // so the pane does not go silent until a reconnect.
      if (!page.messages.length && page.maxRowid > 0 && page.maxRowid < afterRowid) {
        tail.transcriptDbRowid = 0;
        await publishCurrentBatch(tail);
        page = indexedMessagesAfterRowid(tp, sessionId, 0, LIVE_DB_POLL_LIMIT);
      }
      // Same join-hydrated messages as backlog snapshots — do not re-fetch media
      // from a second store on the live path.
      const messages = withImageArtifacts(sessionId, visibleTranscriptMessages(page.messages));
      if (messages.length) {
        tail.lastMessageAt = Date.now();
        evlog("ws_db_poll_publish", {
          sid: tail.sid,
          transcriptPath: tp,
          afterRowid,
          maxRowid: page.maxRowid,
          messages: messages.length,
        });
      }
      for (const message of messages) publishSid(tail.sid, "msg", { message: msgWithHtml(message) });
      tail.transcriptDbRowid = page.maxRowid;
    } catch (err) {
      evlog("ws_transcript_db_poll_error", {
        sid: tail.sid,
        transcriptPath: tp,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      tail.transcriptDbPolling = false;
    }
  };

  const pollQueue = (tail: SidTail) => {
    const queue = listQueue(tail.sid);
    const sig = JSON.stringify(queue);
    if (sig === tail.lastQ) return;
    tail.lastQ = sig;
    publishSid(tail.sid, "queue", { queue });
  };

  const pollOne = async (tail: SidTail) => {
    if (!tail.pane.target) {
      const entry = findEntryByAnyId(tail.sid);
      if (!entry) return;
      // Headless harnesses (OpenCode especially) publish interactive questions
      // on the registry entry — mirror them as the same SSE `prompt` event the
      // pane path uses so the session card can render option buttons.
      const prompt = entry.prompt ?? null;
      const sig = prompt ? JSON.stringify(prompt) : "";
      if (sig !== tail.lastSig) {
        tail.lastSig = sig;
        publishSid(tail.sid, "prompt", { prompt });
      }
      const busy = isAisdkEntryBusy(entry);
      const bsig = busy ? "1" : "0";
      if (bsig !== tail.lastBusy) {
        tail.lastBusy = bsig;
        publishSid(tail.sid, "busy", { busy });
        if (!busy) void publishCurrentBatch(tail);
      }
      traceStallIfNeeded(tail, busy);
      if (!busy) tail.lastDraft.delete(tail.sid);
      return;
    }
    const pane = capturePane(tail.pane.target);
    const prompt = await resolveSessionPrompt(tail.pane.tp, pane);
    const sig = prompt ? JSON.stringify(prompt) : "";
    if (sig !== tail.lastSig) {
      tail.lastSig = sig;
      publishSid(tail.sid, "prompt", { prompt: prompt ?? null });
    }
    const busy = pane ? (tail.pane.agent === "jcode" ? isJcodeBusy(pane) : isBusy(pane)) : false;
    const bsig = busy ? "1" : "0";
    if (bsig !== tail.lastBusy) {
      tail.lastBusy = bsig;
      publishSid(tail.sid, "busy", { busy });
      if (!busy) void publishCurrentBatch(tail);
    }
    traceStallIfNeeded(tail, busy);
  };

  const pollDraft = (tail: SidTail) => {
    const entry = findEntryByAnyId(tail.sid);
    if (!entry || !isAisdkEntryBusy(entry)) return;
    sendAiTextDeltaPart((type, fields) => publishSid(tail.sid, type, fields), tail.sid, entry, tail.lastDraft);
  };

  const ensureSidTail = async (sid: string, tp: string | null): Promise<SidTail> => {
    const existing = sidTails.get(sid);
    if (existing) return existing;
    const tail: SidTail = {
      sid,
      sockets: new Set(),
      pane: { sid, tp, target: null, agent: null },
      lastSig: " ",
      lastBusy: "?",
      lastQ: "[]",
      lastMessageAt: Date.now(),
      lastStallLogAt: 0,
      lastDraft: new Map(),
      pollInterval: null,
      draftInterval: null,
      transcriptUnsub: null,
      transcriptSource: null,
      transcriptDbRowid: null,
      transcriptDbSessionId: null,
      transcriptDbPolling: false,
    };
    sidTails.set(sid, tail);
    if (tp) await subscribeTailToTranscript(tail, tp);
    void hydrateTarget(tail).then(() => void pollOne(tail));
    pollQueue(tail);
    tail.pollInterval = setInterval(() => {
      void ensureTranscriptSubscription(tail).then(() => pollIndexedTranscript(tail));
      void pollOne(tail);
      pollQueue(tail);
      void reconcileQueued(tail.sid).then((changed) => changed && pollQueue(tail));
    }, 1000);
    tail.draftInterval = setInterval(() => pollDraft(tail), 400);
    return tail;
  };

  const readBacklog = async (sid: string, tp: string) => {
    const backlogT0 = performance.now();
    const page = await indexedMessageRowPage(tp, sid, {
      rows: BACKLOG_ROWS,
      chunk: BACKLOG_LIMIT,
      maxMessages: BACKLOG_MAX_MESSAGES,
      countRows: (rows) => countTranscriptRows(transcriptMessagesForClient(sid, rows)),
    });
    const messages = page.messages;
    const readMs = performance.now() - backlogT0;
    const renderT0 = performance.now();
    const rendered = transcriptMessagesForClient(sid, messages).map(msgWithHtml);
    const renderMs = performance.now() - renderT0;
    evlog("ws_backlog", {
      sid,
      messages: rendered.length,
      nextBefore: page.nextBefore,
      readMs: roundMs(readMs),
      renderMs: roundMs(renderMs),
      totalMs: roundMs(performance.now() - backlogT0),
    });
    return { messages: rendered, nextBefore: page.nextBefore, readMs, renderMs };
  };

  async function publishCurrentBatch(tail: SidTail): Promise<void> {
    let tp = tail.pane.tp;
    if (!tp) {
      tp = await resolveTranscript(tail.sid);
      if (!tp) return;
      tail.pane.tp = tp;
      await subscribeTailToTranscript(tail, tp);
    }
    await ensureChatTranscriptCaughtUp(tp, tail.sid, "ws-snapshot");
    const backlog = await readBacklog(tail.sid, tp);
    const channel = transcriptChannel(tail.sid);
    const frame = stamp(channel, {
      t: "snapshot",
      sid: tail.sid,
      messages: backlog.messages,
      nextBefore: backlog.nextBefore,
    });
    const id = channelId(channel);
    for (const ws of tail.sockets) {
      const state = sockets.get(ws);
      if (state && !state.closed && state.subscribed.has(id)) safeSend(ws, frameForSocket(state, frame));
    }
  }

  const replayOrSnapshot = async (
    state: SocketState,
    channel: Channel,
    snapshot: () => Promise<Record<string, unknown>>,
  ): Promise<boolean> => {
    const chState = stateForChannel(channel);
    const resumeFromSeq = typeof channel.resumeFromSeq === "number" && Number.isFinite(channel.resumeFromSeq)
      ? Math.max(0, channel.resumeFromSeq)
      : null;
    if (resumeFromSeq != null && chState.ring.length && resumeFromSeq >= chState.ring[0].seq - 1 && resumeFromSeq <= chState.seq) {
      let replayed = 0;
      for (const item of chState.ring) {
        if (item.seq > resumeFromSeq) {
          safeSend(state.ws, frameForSocket(state, item.frame));
          replayed++;
        }
      }
      safeSend(state.ws, stamp(channel, { t: "resumed", fromSeq: resumeFromSeq, toSeq: chState.seq, replayed }));
      return true;
    }
    if (resumeFromSeq != null && resumeFromSeq > 0) safeSend(state.ws, stamp(channel, { t: "gap" }));
    safeSend(state.ws, frameForSocket(state, stamp(channel, await snapshot())));
    return false;
  };

  const subscribeTranscript = async (state: SocketState, channel: Channel, resync: boolean) => {
    const sid = channel.key;
    const id = channelId(channel);
    const first = !state.subscribed.has(id);
    if (!first && !resync) return;
    if (first && state.subscribed.size >= SUBSCRIPTION_CAP) {
      safeSend(state.ws, { t: "error", sid, message: `subscription cap exceeded (${SUBSCRIPTION_CAP})` });
      return;
    }
    const t0 = performance.now();
    state.subscribed.add(id);
    const tp = await resolveTranscript(sid);
    const entry = findEntryByAnyId(sid);
    if (!tp && !entry) {
      await replayOrSnapshot(state, channel, async () => ({ t: "snapshot", sid, messages: [], nextBefore: null }));
      evlog("ws_subscribe", { rid: state.rid, sid, missing: true, durationMs: roundMs(performance.now() - t0) });
      const tail = await ensureSidTail(sid, null);
      tail.sockets.add(state.ws);
      // A tail can outlive its last browser subscriber. Its queue signature is
      // then already current, so pollQueue() has no change to publish when a new
      // browser joins. Send the current queue directly to hydrate that browser.
      safeSend(state.ws, { t: "queue", sid, queue: listQueue(sid) });
      return;
    }
    // Built inside the closure, because replayOrSnapshot only calls it when the
    // ring replay misses. A reconnect that resumes cleanly used to pay for this
    // anyway — a transcript catch-up, an indexed page read and a markdown
    // render of the backlog — and then throw the whole ~20KB away. Resume is
    // now zero-I/O, which matters most exactly when it fires: many channels
    // re-subscribing at once on the same event loop.
    let snapshotMessages = 0;
    await replayOrSnapshot(state, channel, async () => {
      if (!tp) return { t: "snapshot", sid, messages: [], nextBefore: null };
      await ensureChatTranscriptCaughtUp(tp, sid, "ws-subscribe");
      const backlog = await readBacklog(sid, tp);
      snapshotMessages = backlog.messages.length;
      return { t: "snapshot", sid, messages: backlog.messages, nextBefore: backlog.nextBefore };
    });
    evlog("ws_subscribe", {
      rid: state.rid,
      sid,
      messages: snapshotMessages,
      durationMs: roundMs(performance.now() - t0),
    });
    const tail = await ensureSidTail(sid, tp);
    tail.sockets.add(state.ws);
    safeSend(state.ws, { t: "queue", sid, queue: listQueue(sid) });
    void pollOne(tail);
    pollQueue(tail);
  };

  const unsubscribeTranscript = (state: SocketState, sid: string) => {
    state.subscribed.delete(channelId(transcriptChannel(sid)));
    const tail = sidTails.get(sid);
    if (tail) {
      tail.sockets.delete(state.ws);
      cleanupSidTail(sid);
    }
  };

  const subscribeAgentRun = async (state: SocketState, channel: Channel, resync: boolean) => {
    const id = channelId(channel);
    const first = !state.subscribed.has(id);
    if (!first && !resync) return;
    if (first && state.subscribed.size >= SUBSCRIPTION_CAP) {
      safeSend(state.ws, { t: "error", kind: channel.kind, key: channel.key, message: `subscription cap exceeded (${SUBSCRIPTION_CAP})` });
      return;
    }
    const snapshot = opts.getAgentRun?.(channel.key) ?? null;
    if (!snapshot) {
      safeSend(state.ws, stamp(channel, { t: "error", code: "not_found", message: "run not found" }));
      return;
    }
    state.subscribed.add(id);
    await replayOrSnapshot(state, channel, async () => ({ t: "snapshot", run: snapshot }));
    if (!agentRunUnsubs.has(channel.key) && snapshot.status === "running" && opts.subscribeAgentRun) {
      const unsub = opts.subscribeAgentRun(channel.key, (event) => {
        publishChannelDelta(channel, { event });
        if (event.type === "done" || event.type === "failed") {
          agentRunUnsubs.get(channel.key)?.();
          agentRunUnsubs.delete(channel.key);
        }
      });
      agentRunUnsubs.set(channel.key, unsub);
    }
  };

  const unsubscribeChannel = (state: SocketState, id: string) => {
    const channel = channelFromId(id);
    if (!channel) {
      state.subscribed.delete(id);
      return;
    }
    if (channel.kind === "transcript") {
      unsubscribeTranscript(state, channel.key);
      return;
    }
    state.subscribed.delete(id);
  };

  const closeSocket = (ws: LiveWs) => {
    const state = sockets.get(ws);
    if (!state || state.closed) return;
    state.closed = true;
    if (state.heartbeat) clearInterval(state.heartbeat);
    forgetTypingSocket(ws);
    for (const id of [...state.subscribed]) unsubscribeChannel(state, id);
    openSockets.delete(ws);
    stopStatusLoopIfIdle();
  };

  const validChannel = (value: unknown): Channel | null => {
    if (!value || typeof value !== "object") return null;
    const v = value as { kind?: unknown; key?: unknown; resumeFromSeq?: unknown };
    if (typeof v.kind !== "string" || typeof v.key !== "string") return null;
    if (v.kind === "transcript" && SID_RE.test(v.key)) {
      return {
        kind: "transcript",
        key: v.key,
        resumeFromSeq: typeof v.resumeFromSeq === "number" && Number.isFinite(v.resumeFromSeq) ? v.resumeFromSeq : undefined,
      };
    }
    if (v.kind === "status" && v.key === "*") {
      return {
        kind: "status",
        key: "*",
        resumeFromSeq: typeof v.resumeFromSeq === "number" && Number.isFinite(v.resumeFromSeq) ? v.resumeFromSeq : undefined,
      };
    }
    if (v.kind === "agent_run" && RUN_RE.test(v.key)) {
      return {
        kind: "agent_run",
        key: v.key,
        resumeFromSeq: typeof v.resumeFromSeq === "number" && Number.isFinite(v.resumeFromSeq) ? v.resumeFromSeq : undefined,
      };
    }
    return null;
  };

  const subscribeChannel = (state: SocketState, channel: Channel, resync: boolean) => {
    if (channel.kind === "transcript") {
      void subscribeTranscript(state, channel, resync);
      // Presence is never replayed from the ring, so a socket that just
      // subscribed (or reconnected) would otherwise see nobody until the next
      // keystroke anywhere in the session. Send the current set once. An empty
      // set is still worth sending: it clears whatever a reconnecting client
      // was still drawing from before the drop.
      safeSend(state.ws, { t: "typing", sid: channel.key, ids: typingIdsFor(channel.key) });
      return;
    }
    if (channel.kind === "agent_run") {
      void subscribeAgentRun(state, channel, resync);
      return;
    }
    state.subscribed.add(channelId(channel));
  };

  return {
    dataForRequest(participantId: string | null = null): LiveWsSocketData {
      return {
        liveWs: true,
        rid: crypto.randomUUID?.() ?? `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        participantId,
      };
    },
    isLiveSocket(ws: ServerWebSocket<unknown>): boolean {
      return (ws.data as LiveWsSocketData | undefined)?.liveWs === true;
    },
    open(ws: LiveWs) {
      const data = ws.data as LiveWsSocketData | undefined;
      const rid = data?.rid || "ws";
      const state: SocketState = {
        ws,
        rid,
        subscribed: new Set(),
        closed: false,
        lastTraffic: Date.now(),
        heartbeat: null,
        deferToolArgs: false,
        participantId: data?.participantId ?? null,
      };
      sockets.set(ws, state);
      openSockets.add(ws);
      evlog("ws_connect", { rid });
      ensureStatusLoop();
      void sendStatusBaseline(ws);
      state.heartbeat = setInterval(() => {
        if (state.closed) return;
        if (Date.now() - state.lastTraffic > IDLE_CLOSE_MS) {
          try {
            ws.close();
          } catch {}
          closeSocket(ws);
          return;
        }
        safeSend(ws, { t: "ping" });
      }, HEARTBEAT_MS);
    },
    message(ws: LiveWs, raw: string | Uint8Array | ArrayBuffer) {
      const state = sockets.get(ws);
      if (!state || state.closed || typeof raw !== "string") return;
      state.lastTraffic = Date.now();
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        safeSend(ws, { t: "error", message: "invalid json" });
        return;
      }
      const input = msg as {
        t?: string;
        id?: unknown;
        ids?: unknown;
        channels?: unknown;
        kind?: unknown;
        key?: unknown;
        sid?: unknown;
        before?: unknown;
        limit?: unknown;
        resync?: unknown;
        deferToolArgs?: unknown;
        typing?: unknown;
      };
      if (input.t === "pong") return;
      // Browser-initiated ping probes measure the real WebSocket round trip.
      // Heartbeat pings in the other direction remain id-less and are answered
      // by the browser with the existing id-less pong.
      if (input.t === "ping") {
        const id = typeof input.id === "string" && input.id.length <= 128 ? input.id : undefined;
        safeSend(ws, { t: "pong", ...(id ? { id } : {}) });
        return;
      }
      if (input.t === "subscribe") {
        // Capability handshake. Additive and optional: a client that omits it
        // keeps the full inline tool arguments it has always received. It is
        // latched, never cleared, so a resubscribe cannot silently downgrade a
        // client that already renders pills from the deferred shape.
        if (input.deferToolArgs === true) state.deferToolArgs = true;
        const requested = Array.isArray(input.channels) ? input.channels : [];
        const channels = requested
          .map(validChannel)
          .filter((channel): channel is Channel => !!channel);
        // A channel kind this server doesn't know MUST be answered, not silently
        // dropped. A client cached from before a channel was retired (service
        // worker keeps old bundles alive across deploys) otherwise waits forever
        // on a subscription that will never produce a frame — its request promise
        // never settles and its UI hangs mid-operation. An error frame lets the
        // old client's existing error path reject and clean up.
        if (channels.length !== requested.length) {
          for (const raw of requested) {
            if (validChannel(raw)) continue;
            const v = raw as { kind?: unknown; key?: unknown };
            safeSend(ws, {
              t: "error",
              kind: typeof v?.kind === "string" ? v.kind : undefined,
              key: typeof v?.key === "string" ? v.key : undefined,
              code: "unknown_channel",
              message: "unknown or malformed channel",
            });
          }
        }
        const ids = Array.isArray(input.ids)
          ? input.ids.filter((id): id is string => typeof id === "string" && SID_RE.test(id))
          : [];
        for (const sid of ids) channels.push(transcriptChannel(sid));
        for (const channel of channels) subscribeChannel(state, channel, input.resync === true);
        return;
      }
      if (input.t === "unsubscribe") {
        const channels = Array.isArray(input.channels)
          ? input.channels.map(validChannel).filter((channel): channel is Channel => !!channel)
          : [];
        const ids = Array.isArray(input.ids)
          ? input.ids.filter((id): id is string => typeof id === "string" && SID_RE.test(id))
          : [];
        for (const sid of ids) channels.push(transcriptChannel(sid));
        for (const channel of channels) unsubscribeChannel(state, channelId(channel));
        return;
      }
      if (input.t === "typing") {
        // A socket may only ever speak for the identity resolved at upgrade.
        // The frame carries no author field, so a browser cannot nominate one:
        // an unmanaged socket (participantId null) is silently inert rather
        // than able to put somebody else's face on the indicator.
        const sid = typeof input.sid === "string" && SID_RE.test(input.sid) ? input.sid : null;
        if (!sid || !state.participantId) return;
        // Presence is only meaningful to someone watching this session, and
        // requiring the subscription stops an unsubscribed socket from
        // spraying claims at sessions it is not even reading.
        if (!state.subscribed.has(channelId(transcriptChannel(sid)))) return;
        setTyping(sid, ws, state.participantId, input.typing === true);
        return;
      }
      safeSend(ws, { t: "error", message: "unknown live websocket message" });
    },
    close: closeSocket,
  };
}
