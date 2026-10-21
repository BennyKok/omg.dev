import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OmgLiveConnection, type OmgTranscriptEvent } from "@omg-dev/client";
import type { MessageAuthorRef } from "../../src/conversation-contract";
import { evlog } from "./lib/evlog";
import { openOmgLiveSocket } from "./lib/omg-client";
import type { OmgQueueMessage } from "./lib/omg-chat-transport";
import {
  queueRowHydration,
  reconcileQueueMessages,
} from "./lib/queue-reconcile";
import { windowLiveMessages } from "./lib/transcript-paging";

// The live socket is OmgLiveConnection from @omg-dev/client, the same client
// iOS and @omg-dev/react use: connect, reconnect, resume cursors, status,
// change announcements, queue, typing and drafts all live there. This hook
// only turns its events into the per-session React state the app renders.

type Session = {
  agent?: string;
  title?: string | null;
  lastUserText?: string | null;
  sessionId: string | null;
  startedAt?: number | null;
  lastActivityAt?: number | null;
  last?: { role?: string; kind?: string; text?: string; ts?: number };
  busy?: boolean;
  status?: "ok" | "blocked";
  statusReason?: "model_unavailable" | "out_of_credits" | "provider_auth" | "provider_error" | "restart_recovered" | "interrupted" | "out_of_memory" | null;
  statusDetail?: string | null;
  model?: string | null;
};

export type Message = {
  id?: string;
  role?: string;
  kind?: string;
  /** Kind `work`: the steps of one run, folded by the server. Empty means withdrawn. */
  steps?: Message[];
  /** An artifact: the display tool call that produced it. */
  tool?: Message;
  text?: string;
  html?: string;
  ts?: number;
  url?: string;
  artifactId?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  caption?: string;
  alt?: string;
  version?: number;
  title?: string;
  pending?: boolean;
  queued?: boolean;
  // A send the queue gave up on: stays visible with its error until the user
  // retries (queueId targets the retry endpoint) or clears the queue.
  failed?: boolean;
  queueError?: string;
  queueId?: string;
  seed?: boolean;
  catchUp?: boolean;
  author?: MessageAuthorRef;
};

export type AiStreamPart = {
  type: "text-delta" | "text-start" | "text-end" | "error" | string;
  id?: string;
  kind?: "text" | "thinking";
  delta?: string;
  text?: string;
  reset?: boolean;
  ts?: number;
};

type PromptOption = { index: number; label: string; selected?: boolean };
type SessionPrompt = { question?: string; options: PromptOption[] };
type QueueMsg = OmgQueueMessage;
type StatusRow = Pick<
  Session,
  | "sessionId"
  | "busy"
  | "title"
  | "lastUserText"
  | "lastActivityAt"
  | "status"
  | "statusReason"
  | "statusDetail"
  | "model"
>;
/** A list the server says changed (see OmgChangeTopic in @omg-dev/protocol). */
export type { OmgChangeTopic as ChangeTopic } from "@omg-dev/protocol";
import type { OmgChangeTopic as ChangeTopic } from "@omg-dev/protocol";

export type TranscriptEvent =
  | { type: "snapshot"; messages: Message[]; nextBefore: number | null }
  | { type: "message"; message: Message }
  | { type: "ai_part"; part: AiStreamPart }
  | { type: "queue"; queue: QueueMsg[] }
  | { type: "busy"; busy: boolean }
  | { type: "error"; error: string };
export type TranscriptSubscribe = (
  sid: string,
  listener: (event: TranscriptEvent) => void,
  options?: {
    /**
     * Listen without holding a subscription. The listener hears whatever the
     * socket already streams for this sid because something else (an open
     * transcript, an expanded card) subscribed it, and nothing when nothing
     * did. A plain subscribe pulls the full backlog snapshot and the send
     * queue the moment it attaches — fine for a transcript that is about to
     * be shown, hundreds of KB of waste for a watcher that only wants to know
     * that something new arrived.
     */
    passive?: boolean;
  },
) => () => void;

const DRAFT_CATCHUP_MIN_CHARS = 160;
declare global {
  interface Window {
    __LFG_CONFIG__?: { liveTransport?: string };
  }
}

export function liveTransportMode(): "sse" | "ws" {
  const runtime = typeof window !== "undefined" ? window.__LFG_CONFIG__?.liveTransport : undefined;
  const build = import.meta.env.VITE_LIVE_TRANSPORT;
  return runtime === "sse" || build === "sse" ? "sse" : "ws";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);
}

function normText(value?: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function messageNeedle(value?: string) {
  return normText(value).slice(0, 48);
}

function sameMessageNeedle(a?: string, b?: string) {
  const an = messageNeedle(a);
  const bn = messageNeedle(b);
  if (!an || !bn) return false;
  return an.includes(bn) || bn.includes(an);
}

function hydrateQueueMessage(item: QueueMsg): Message {
  return {
    id: `queue-${item.id}`,
    role: "user",
    kind: "text",
    text: item.text,
    html: escapeHtml(item.text).replace(/\n/g, "<br>"),
    ts: item.createdAt ?? item.updatedAt ?? Date.now(),
    ...queueRowHydration(item),
  };
}

function seedMessageForSession(session: Session): Message | null {
  const sid = session.sessionId;
  const last = session.last;
  const lastIsProse =
    last?.kind === "text" && (last.role === "assistant" || last.role === "user") && !!last.text;
  const text = normText(lastIsProse ? last.text : session.lastUserText || "");
  if (!sid || !text) return null;
  const role = lastIsProse && last.role === "assistant" ? "assistant" : "user";
  const ts = (lastIsProse ? last.ts : null) ?? session.lastActivityAt ?? session.startedAt ?? Date.now();
  return {
    id: `seed-${sid}-${ts}-${role}`,
    role,
    kind: "text",
    text,
    html: escapeHtml(text).replace(/\n/g, "<br>"),
    ts,
    seed: true,
  };
}

function isDraftAssistantMessage(message: Message) {
  return (
    message.role === "assistant" &&
    (message.kind === "text" || message.kind === "thinking") &&
    typeof message.id === "string" &&
    message.id.startsWith("draft-")
  );
}

function collapseThinkingRuns(messages: Message[]) {
  const out: Message[] = [];
  for (const message of messages) {
    if (message.kind === "thinking" && out[out.length - 1]?.kind === "thinking") out[out.length - 1] = message;
    else out.push(message);
  }
  return out;
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

function mediaIdentity(message: Message): string | null {
  if (message.kind !== "image" && message.kind !== "video" && message.kind !== "file") {
    return message.id ?? null;
  }
  const artifactId = message.artifactId || artifactIdFromUrl(message.url);
  if (artifactId) return `artifact-${artifactId}`;
  if (message.url) return `media-${message.kind}-${message.url}`;
  if (message.id) return message.id;
  return `media-${message.kind}-${message.ts ?? "no-ts"}-${message.name ?? ""}-${message.size ?? ""}-${message.text ?? ""}`;
}

function normalizeMessageIdentity(message: Message): Message {
  const id = mediaIdentity(message);
  if (!id || id === message.id) return message;
  return { ...message, id };
}

function normalizeMessageList(messages: Message[]): Message[] {
  return messages.map(normalizeMessageIdentity);
}

// Media order is owned by the server transcript index (joined artifact rows).
// Live upserts must keep an existing card's position and append brand-new media
// at the tail — never re-sort by timestamp, which put images out of place when
// a second poll stream raced the ordered transcript.
function upsertMessageById(current: Message[], message: Message): Message[] {
  const normalized = normalizeMessageIdentity(message);
  const id = mediaIdentity(normalized);
  if (!id || normalized.kind === "thinking") return [...current.filter((item) => item.kind !== "thinking"), normalized];
  const existingIndex = current.findIndex((item) => mediaIdentity(item) === id);
  // A real user row claims exactly ONE pending bubble with the same text —
  // claiming all of them would make a repeated identical follow-up vanish.
  let pendingClaimed = false;
  const withoutTransient = current.filter((item, index) => {
    if (index === existingIndex) return false;
    if (item.kind === "thinking") return false;
    if (normalized.role === "user" && normalized.kind === "text") {
      if (item.pending && !pendingClaimed && sameMessageNeedle(normalized.text, item.text)) {
        pendingClaimed = true;
        return false;
      }
      return true;
    }
    if (normalized.role === "assistant" && normalized.kind === "text" && isDraftAssistantMessage(item)) return false;
    return true;
  });
  if (existingIndex >= 0) {
    const insertAt = Math.min(existingIndex, withoutTransient.length);
    return [...withoutTransient.slice(0, insertAt), normalized, ...withoutTransient.slice(insertAt)];
  }
  return [...withoutTransient, normalized];
}

function reconcileSnapshotMessages(current: Message[], incoming: Message[]): Message[] {
  const authoritative = collapseThinkingRuns(normalizeMessageList(incoming));
  const next = authoritative.filter((message) => !message.seed);
  const incomingIds = new Set(next.map(mediaIdentity).filter(Boolean));
  const incomingUserText = next.filter((message) => message.role === "user" && message.kind === "text");
  const latestIncomingTs = next.reduce((max, message) => Math.max(max, message.ts ?? 0), 0);
  // Incoming user rows claim local pending bubbles one-to-one: with a repeated
  // identical follow-up, only as many bubbles settle as rows actually arrived.
  const claimedIncoming = new Set<number>();
  for (const local of current) {
    const normalized = normalizeMessageIdentity(local);
    if (normalized.seed || normalized.kind === "thinking") continue;
    const id = mediaIdentity(normalized);
    if (id && incomingIds.has(id)) continue;
    if (normalized.pending) {
      const claimIndex = incomingUserText.findIndex(
        (message, index) => !claimedIncoming.has(index) && sameMessageNeedle(message.text, normalized.text),
      );
      if (claimIndex >= 0) {
        claimedIncoming.add(claimIndex);
        continue;
      }
    }
    const localTs = normalized.ts ?? (normalized.pending ? Date.now() : 0);
    if (normalized.pending || !latestIncomingTs || localTs >= latestIncomingTs) next.push(normalized);
  }
  return windowLiveMessages(collapseThinkingRuns(next));
}

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";
export type ConnectionState = {
  status: ConnectionStatus;
  attempt: number;
  lastCloseCode: number | null;
  lastCloseReason: string | null;
  lastMessageAt: number | null;
  latencyMs: number | null;
};

const INITIAL_CONNECTION_STATE: ConnectionState = {
  status: "connecting",
  attempt: 0,
  lastCloseCode: null,
  lastCloseReason: null,
  lastMessageAt: null,
  latencyMs: null,
};

/** The web's socket: OmgLiveConnection over the current Computer transport. */
function createLiveConnection(viewerIdentity: string): OmgLiveConnection {
  return new OmgLiveConnection(
    // Read at every connect: a host swaps the transport in place when the
    // user switches Computers, and the next socket must go to the new one.
    { openLiveSocket: (query?: string) => openOmgLiveSocket(query) },
    {
      capabilities: { workRows: true, deferToolArgs: true },
      // Typing presence: declared at connect time and never on a frame, so a
      // socket cannot rename itself mid-session.
      socketQuery: () => (viewerIdentity ? `user=${encodeURIComponent(viewerIdentity)}` : undefined),
      timing: { latencyIntervalMs: 5_000 },
      onEvent: (event, fields) => evlog(`ws_client_${event}`, fields),
    },
  );
}

/** The consumer-facing event for a client event, or null when consumers do not see it. */
function consumerEvent(event: OmgTranscriptEvent): TranscriptEvent | null {
  if (event.type === "snapshot") return {
    type: "snapshot",
    messages: collapseThinkingRuns(normalizeMessageList(event.messages as Message[])),
    nextBefore: event.nextBefore ?? null,
  };
  if (event.type === "message") return { type: "message", message: normalizeMessageIdentity(event.message as Message) };
  if (event.type === "ai_part") return { type: "ai_part", part: event.part as AiStreamPart };
  if (event.type === "queue") return { type: "queue", queue: event.queue };
  if (event.type === "busy") return { type: "busy", busy: event.busy };
  if (event.type === "error") return { type: "error", error: event.error };
  return null;
}

export function useLiveSocket(
  sessions: Session[],
  streamIds: string[],
  opts: {
    enabled?: boolean;
    onStatusRows?: (rows: StatusRow[]) => void;
    /** The server says these lists changed. Empty: the socket just opened. */
    onChanged?: (topics: ChangeTopic[]) => void;
    /**
     * Who this browser is, for typing presence. A managed box ignores it and
     * uses its verified header instead; an unmanaged one validates it
     * against the roster.
     */
    viewerIdentity?: string | null;
  } = {},
) {
  const enabled = opts.enabled ?? liveTransportMode() === "ws";
  const viewerIdentity = opts.viewerIdentity?.trim() || "";
  const onStatusRowsRef = useRef(opts.onStatusRows);
  useEffect(() => {
    onStatusRowsRef.current = opts.onStatusRows;
  }, [opts.onStatusRows]);
  const onChangedRef = useRef(opts.onChanged);
  useEffect(() => {
    onChangedRef.current = opts.onChanged;
  }, [opts.onChanged]);

  const ids = useMemo(() => streamIds.filter((id): id is string => !!id), [streamIds]);
  const streamKey = ids.join(",");
  const listBusy = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const session of sessions) if (session.sessionId) map[session.sessionId] = !!session.busy;
    return map;
  }, [sessions]);
  const seedBySid = useMemo(() => {
    const map: Record<string, Message> = {};
    for (const session of sessions) {
      const seed = seedMessageForSession(session);
      if (session.sessionId && seed) map[session.sessionId] = seed;
    }
    return map;
  }, [sessions]);

  const [messagesBySid, setMessagesBySid] = useState<Record<string, Message[]>>({});
  const [busyBySid, setBusyBySid] = useState<Record<string, boolean>>({});
  const [promptsBySid, setPromptsBySid] = useState<Record<string, SessionPrompt | null>>({});
  // Participant ids typing per session, replaced wholesale by each frame.
  const [typingBySid, setTypingBySid] = useState<Record<string, string[]>>({});
  const [connection, setConnection] = useState<ConnectionState>(INITIAL_CONNECTION_STATE);
  const [live, setLive] = useState<OmgLiveConnection | null>(null);

  const thinkTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const firstMsgRef = useRef<Set<string>>(new Set());
  const draftSeenRef = useRef<Set<string>>(new Set());
  const openAtRef = useRef(0);
  /** The hook's own subscription per session, which folds events into state. */
  const foldRef = useRef<Map<string, () => void>>(new Map());
  /** Sessions the app shows expanded. */
  const expandedRef = useRef<Set<string>>(new Set());
  /** Per session, how many consumer listeners hold a subscription. */
  const activeConsumersRef = useRef<Record<string, number>>({});

  // One connection per hook and viewer. The viewer is decided at connect time
  // and can never change on an open socket, so a profile switch reconnects.
  useEffect(() => {
    if (!enabled) return;
    const connectionForViewer = createLiveConnection(viewerIdentity);
    setLive(connectionForViewer);
    const offConnection = connectionForViewer.subscribeConnection((state) => {
      if (state.status === "live") {
        openAtRef.current = performance.now();
        firstMsgRef.current = new Set();
        draftSeenRef.current = new Set();
      }
      setConnection((prev) => ({
        ...prev,
        status: state.status,
        attempt: state.attempt,
        lastCloseCode: state.lastCloseCode ?? prev.lastCloseCode,
        lastCloseReason: state.lastCloseReason ?? prev.lastCloseReason,
        latencyMs: state.latencyMs ?? null,
      }));
    });
    // Status rows and change announcements keep the socket open for as long
    // as the app runs, transcripts or not.
    const offStatus = connectionForViewer.subscribeStatus((rows) => onStatusRowsRef.current?.(rows as StatusRow[]));
    const offChanges = connectionForViewer.subscribeChanges((topics) => onChangedRef.current?.(topics as ChangeTopic[]));
    return () => {
      offChanges();
      offStatus();
      offConnection();
      for (const off of foldRef.current.values()) off();
      foldRef.current = new Map();
      for (const sid of Object.keys(thinkTimerRef.current)) {
        clearTimeout(thinkTimerRef.current[sid]);
        delete thinkTimerRef.current[sid];
      }
      connectionForViewer.dispose();
      setLive(null);
    };
  }, [enabled, viewerIdentity]);

  const markFirst = useCallback((sid: string, message: Message, batch = false, count?: number) => {
    if (firstMsgRef.current.has(sid)) return;
    firstMsgRef.current.add(sid);
    evlog("ws_client_first_msg", {
      sid,
      kind: message.kind,
      role: message.role,
      batch,
      count,
      elapsedMs: Math.round((performance.now() - openAtRef.current) * 1000) / 1000,
    });
  }, []);

  /** Fold one session's events into the state the app renders. */
  const fold = useCallback((sid: string, event: OmgTranscriptEvent) => {
    if (event.type === "snapshot") {
      const messages = collapseThinkingRuns(normalizeMessageList((event.messages ?? []) as Message[]));
      if (messages.length) markFirst(sid, messages[0], true, messages.length);
      setMessagesBySid((prev) => ({ ...prev, [sid]: reconcileSnapshotMessages(prev[sid] ?? [], messages) }));
      return;
    }
    if (event.type === "message") {
      const message = normalizeMessageIdentity(event.message as Message);
      markFirst(sid, message);
      setMessagesBySid((prev) => ({ ...prev, [sid]: windowLiveMessages(upsertMessageById(prev[sid] ?? [], message)) }));
      const timers = thinkTimerRef.current;
      if (timers[sid]) clearTimeout(timers[sid]);
      if (message.kind === "thinking") {
        timers[sid] = setTimeout(() => {
          delete timers[sid];
          setMessagesBySid((prev) => {
            const cur = prev[sid];
            if (!cur?.some((item) => item.kind === "thinking")) return prev;
            return { ...prev, [sid]: cur.filter((item) => item.kind !== "thinking") };
          });
        }, 2500);
      } else {
        delete timers[sid];
      }
      return;
    }
    if (event.type === "ai_part") {
      const part = event.part as AiStreamPart;
      if (part?.type !== "text-delta" || !part.id) return;
      const timers = thinkTimerRef.current;
      if (timers[sid]) {
        clearTimeout(timers[sid]);
        delete timers[sid];
      }
      const firstDraftForSid = !draftSeenRef.current.has(sid);
      draftSeenRef.current.add(sid);
      setMessagesBySid((prev) => {
        const current = prev[sid] ?? [];
        const existing = current.find((message) => isDraftAssistantMessage(message) && message.id === part.id);
        const text = part.reset ? (part.text ?? part.delta ?? "") : `${existing?.text ?? ""}${part.delta ?? ""}`;
        if (!text) return prev;
        const catchUp = existing?.catchUp ?? (firstDraftForSid && !!part.reset && text.length > DRAFT_CATCHUP_MIN_CHARS);
        const message: Message = {
          id: part.id,
          role: "assistant",
          kind: part.kind ?? "text",
          text,
          ts: part.ts ?? Date.now(),
          catchUp,
        };
        return {
          ...prev,
          [sid]: windowLiveMessages([
            ...current.filter((item) => item.kind !== "thinking" && item.id !== part.id),
            message,
          ]),
        };
      });
      return;
    }
    if (event.type === "busy") {
      const busy = event.busy;
      setBusyBySid((prev) => ({ ...prev, [sid]: busy }));
      if (!busy) {
        const tm = thinkTimerRef.current[sid];
        if (tm) {
          clearTimeout(tm);
          delete thinkTimerRef.current[sid];
        }
        setMessagesBySid((prev) => {
          const current = prev[sid];
          if (!current?.some((item) => item.kind === "thinking")) return prev;
          return { ...prev, [sid]: current.filter((item) => item.kind !== "thinking") };
        });
      }
      return;
    }
    if (event.type === "prompt") {
      setPromptsBySid((prev) => ({ ...prev, [sid]: (event.prompt as SessionPrompt | null) ?? null }));
      return;
    }
    if (event.type === "queue") {
      const queue = event.queue;
      setMessagesBySid((prev) => ({
        ...prev,
        [sid]: reconcileQueueMessages(prev[sid] ?? [], queue, hydrateQueueMessage),
      }));
      return;
    }
    if (event.type === "typing") {
      // Replace, never merge: the frame IS the current set, so a person who
      // stopped typing is expressed by their absence from it.
      const typing = event.ids;
      setTypingBySid((prev) => {
        const current = prev[sid];
        if (current && current.length === typing.length && current.every((id, i) => id === typing[i])) return prev;
        return { ...prev, [sid]: typing };
      });
    }
  }, [markFirst]);

  /** Hold or release the hook's own subscription for each session in `wanted`. */
  const syncFolds = useCallback((wanted: Set<string>) => {
    if (!live) return;
    for (const [sid, off] of foldRef.current) {
      if (wanted.has(sid)) continue;
      off();
      foldRef.current.delete(sid);
    }
    for (const sid of wanted) {
      if (foldRef.current.has(sid)) continue;
      foldRef.current.set(sid, live.subscribeTranscript(sid, (event) => fold(sid, event)));
    }
  }, [live, fold]);

  const wantedSessions = useCallback(() => new Set([
    ...expandedRef.current,
    ...Object.entries(activeConsumersRef.current).filter(([, count]) => count > 0).map(([sid]) => sid),
  ]), []);

  useEffect(() => {
    const expanded = new Set(ids);
    expandedRef.current = expanded;
    const active = wantedSessions();
    const liveSids = new Set(Object.keys(listBusy));
    setMessagesBySid((prev) => {
      const next: Record<string, Message[]> = {};
      // Keep message state for every session we are (or stay) subscribed to,
      // not just busy ones: a resubscribe without its cursor gets a fresh
      // snapshot, but while subscribed the server never re-sends one.
      for (const sid of new Set([...liveSids, ...active])) {
        const current = prev[sid];
        next[sid] = current?.length ? current : seedBySid[sid] ? [seedBySid[sid]] : [];
      }
      return next;
    });
    setBusyBySid((prev) => Object.fromEntries(Object.entries(prev).filter(([sid]) => active.has(sid))));
    setPromptsBySid((prev) => Object.fromEntries(Object.entries(prev).filter(([sid]) => active.has(sid))));
    // Presence has no resume cursor: leaving a session ends the subscription
    // that feeds it, so a retained set would freeze. Re-entering resubscribes
    // and the server sends the current set again.
    setTypingBySid((prev) => Object.fromEntries(Object.entries(prev).filter(([sid]) => active.has(sid))));
    syncFolds(active);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey, listBusy, seedBySid, syncFolds]);

  const sendTyping = useCallback((sid: string, typing: boolean) => {
    live?.sendTyping(sid, typing);
  }, [live]);

  const reconnectNow = useCallback(() => {
    // Cut the wait, keep a live socket.
    live?.reconnectNow({ force: false });
  }, [live]);

  const subscribeTranscript = useCallback<TranscriptSubscribe>((sid, listener, options) => {
    if (!live) return () => {};
    const passive = !!options?.passive;
    const off = live.subscribeTranscript(sid, (event) => {
      const mapped = consumerEvent(event);
      if (mapped) listener(mapped);
    }, { passive });
    if (passive) return off;
    activeConsumersRef.current[sid] = (activeConsumersRef.current[sid] ?? 0) + 1;
    syncFolds(wantedSessions());
    return () => {
      off();
      const remaining = (activeConsumersRef.current[sid] ?? 1) - 1;
      if (remaining > 0) activeConsumersRef.current[sid] = remaining;
      else delete activeConsumersRef.current[sid];
      syncFolds(wantedSessions());
    };
  }, [live, syncFolds, wantedSessions]);

  const mergedBusy = useMemo(() => ({ ...listBusy, ...busyBySid }), [listBusy, busyBySid]);

  return {
    messagesBySid,
    typingBySid,
    sendTyping,
    busyBySid: mergedBusy,
    promptsBySid,
    connection,
    reconnectNow,
    subscribeTranscript,
  };
}
