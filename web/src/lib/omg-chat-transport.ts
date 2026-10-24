import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { omgFetch } from "./omg-client";
import {
  matchedQueueRowIds,
  queueRowNeedsBubble,
  queueRowHydration,
  queuedMessageId,
  QUEUE_MESSAGE_ID_PREFIX,
  type QueueReconcileMessage,
} from "./queue-reconcile";

export type OmgMessage = {
  id?: string;
  /** Client-only React identity. It is never required on the wire. */
  renderKey?: string;
  role?: string;
  kind?: string;
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
  pending?: boolean;
  // Sent with mode:"queue" while a turn was still running, so the agent has not
  // read it yet — it waits behind the turn in the send queue. Renders as its own
  // "waiting" state instead of an ordinary in-flight bubble, and clears when the
  // real transcript row for the same text replaces the optimistic one.
  queued?: boolean;
  // The send queue gave up on this message. Stays visible with the delivery
  // error until the user retries (queueId targets the retry endpoint) or
  // clears the queue.
  failed?: boolean;
  queueError?: string;
  queueId?: string;
  seed?: boolean;
  catchUp?: boolean;
  /** A live draft: the server's draft id it is drawing, for one turn. */
  draftOf?: string;
};

export type OmgAiStreamPart = {
  type: "text-delta" | "text-start" | "text-end" | "error" | string;
  id?: string;
  kind?: "text" | "thinking";
  delta?: string;
  text?: string;
  reset?: boolean;
  ts?: number;
};

export type OmgQueueMessage = {
  id: string;
  text: string;
  status: "pending" | "sending" | "queued" | "held" | "failed" | "delivered";
  error?: string;
  createdAt?: number;
  updatedAt?: number;
  queuedBehindTurn?: boolean;
  /** Client-only: the key of the card that drew this row before the server had it. */
  renderKey?: string;
};

export type OmgChatMetadata = {
  omgMessage?: OmgMessage;
  /**
   * A reply this browser's own stream assembled: the server time its first
   * part was written. It has no server row yet, and so no `ts`, but a message
   * sent while it streams must still be ordered after it.
   */
  startedAt?: number;
};

export type OmgChatDataParts = {
  omgMessage: OmgMessage;
};

export type OmgChatMessage = UIMessage<OmgChatMetadata, OmgChatDataParts>;

export type OmgTranscriptEvent =
  | { type: "snapshot"; messages: OmgMessage[]; nextBefore: number | null }
  | { type: "message"; message: OmgMessage }
  | { type: "ai_part"; part: OmgAiStreamPart }
  | { type: "queue"; queue: OmgQueueMessage[] }
  | { type: "busy"; busy: boolean }
  | { type: "error"; error: string };

export type OmgTranscriptSubscribe = (
  sid: string,
  listener: (event: OmgTranscriptEvent) => void,
) => () => void;

// A focused chat consumes transcript events twice: once through useChat's
// transport and once through the passive subscription that also handles turns
// started outside this browser. The transport must claim a locally-started
// stream before it can emit its first event; React status is intentionally not
// involved because its render notification can lag behind that event.
export class OmgChatStreamOwnership {
  readonly #counts = new Map<string, number>();

  owns(sid: string): boolean {
    return (this.#counts.get(sid) ?? 0) > 0;
  }

  async run<T>(sid: string, task: () => Promise<T>): Promise<T> {
    this.#counts.set(sid, (this.#counts.get(sid) ?? 0) + 1);
    try {
      return await task();
    } finally {
      const remaining = (this.#counts.get(sid) ?? 1) - 1;
      if (remaining > 0) this.#counts.set(sid, remaining);
      else this.#counts.delete(sid);
    }
  }
}

type OmgChatTransportOptions = {
  sessionId: string;
  sendEndpoint?: string;
  apiBase?: string;
  subscribeTranscript?: OmgTranscriptSubscribe;
  fetch?: typeof globalThis.fetch;
  /**
   * Who is sending, declared on every turn so the server can attribute it.
   *
   * Both send endpoints read the same `user` field. On a managed box it is
   * ignored in favour of the verified header; on a self-hosted one it is
   * validated against the roster, so it can name an existing member and
   * nobody else. Omitted when unknown, which attributes nothing rather than
   * attributing the wrong person.
   */
  viewerIdentity?: string | null;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);
}

function normText(value?: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function messageTs(message: OmgChatMessage) {
  return message.metadata?.omgMessage?.ts ?? message.metadata?.startedAt ?? 0;
}

function textFromUIParts(message: OmgChatMessage) {
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function localMessageFromText(message: OmgMessage): OmgChatMessage {
  const role = message.role === "user" || message.role === "system" ? message.role : "assistant";
  return {
    id: message.id ?? `${role}-${message.ts ?? Date.now()}-${normText(message.text).slice(0, 16)}`,
    role,
    metadata: { omgMessage: message },
    parts: [{ type: "text", text: message.text ?? "", state: "done" }],
  };
}

function localMessageFromData(message: OmgMessage): OmgChatMessage {
  return {
    id: message.id ?? `lfg-${message.kind ?? "message"}-${message.ts ?? Date.now()}`,
    role: message.role === "user" || message.role === "system" ? message.role : "assistant",
    metadata: { omgMessage: message },
    parts: [{ type: "data-omgMessage", id: message.id, data: message }],
  };
}

export function omgMessagesToUIMessages(messages: OmgMessage[]): OmgChatMessage[] {
  return messages
    .filter((message) => !message.seed)
    .map((message) =>
      message.kind === "text" && (message.role === "user" || message.role === "assistant" || message.role === "system")
        ? localMessageFromText(message)
        : localMessageFromData(message),
    );
}

export function omgUIMessagesToMessages(messages: OmgChatMessage[]): OmgMessage[] {
  return messagesInTranscriptOrder(messages).flatMap(projectOmgMessage);
}

/** Keep settled rows stable across sends and streaming updates. The SDK and
 * transcript reducers replace changed messages; unchanged objects are immutable.
 * Scope the cache to one mounted chat and let removed messages be collected. */
export function createOmgMessageProjector() {
  const cache = new WeakMap<OmgChatMessage, OmgMessage[]>();
  return (messages: OmgChatMessage[]): OmgMessage[] =>
    messagesInTranscriptOrder(messages).flatMap((message) => {
      let rows = cache.get(message);
      if (!rows) {
        rows = projectOmgMessage(message);
        cache.set(message, rows);
      }
      return rows;
    });
}

function projectOmgMessage(message: OmgChatMessage): OmgMessage[] {
  const out: OmgMessage[] = [];
  message.parts.forEach((part, index) => {
    if (part.type === "data-omgMessage") {
      out.push(part.data);
      return;
    }
    if (part.type === "reasoning") {
      out.push({
        id: `${message.id}-reasoning-${index}`,
        role: "assistant",
        kind: "thinking",
        text: part.text,
        ts: message.metadata?.omgMessage?.ts,
      });
      return;
    }
    if (part.type === "file") {
      const top = part.mediaType.split("/")[0];
      out.push({
        id: `${message.id}-file-${index}`,
        role: message.role,
        kind: top === "video" ? "video" : "image",
        url: part.url,
        mimeType: part.mediaType,
        name: part.filename,
        ts: message.metadata?.omgMessage?.ts,
      });
      return;
    }
    if (part.type !== "text") return;
    const base = message.metadata?.omgMessage;
    const streaming = message.role === "assistant" && part.state === "streaming";
    const key = textPartRowKey(message, index);
    out.push({
      ...base,
      // `draft-` marks a reply still being written (see isLiveReply); the
      // row's identity is the key, which stays the same when it finishes.
      id: streaming ? `draft-${key}` : index === 0 ? message.id : key,
      renderKey: key,
      role: message.role,
      kind: "text",
      text: part.text,
      html: message.role === "user" ? escapeHtml(part.text).replace(/\n/g, "<br>") : base?.html,
      pending: base?.pending,
      queued: base?.queued,
      catchUp: base?.catchUp,
    });
  });
  return out.filter((message) => message.kind !== "text" || !!message.text || message.role !== "assistant");
}

// ---- Row identity ---------------------------------------------------------
//
// One message passes through several ids on its way to the transcript: the AI
// SDK's id for your send, a queue id while the server holds it, the draft id
// while a reply streams, and finally the server's row id. React keys rows by
// identity, so each change of id unmounted the bubble and mounted a new one:
// the height was estimated again, the scroll anchor moved and the entrance
// played again. That is the stutter between "sending", "sent" and "answered".
//
// The row key is the identity of the FIRST row that drew the message. Every
// write that confirms a local row with a server row hands the key over
// (adoptRowKey), so a message keeps one row from the moment you send it.

/** The key a message's row is drawn under. */
export function omgRowKey(message: OmgChatMessage): string {
  return message.metadata?.omgMessage?.renderKey ?? message.id;
}

function textPartRowKey(message: OmgChatMessage, index: number): string {
  return index === 0 ? omgRowKey(message) : `${message.id}-text-${index}`;
}

/** `incoming` drawn in the row `key` already owns. */
function adoptRowKey(incoming: OmgChatMessage, key: string): OmgChatMessage {
  const base = incoming.metadata?.omgMessage;
  if (!base || key === incoming.id || base.renderKey === key) return incoming;
  return { ...incoming, metadata: { ...incoming.metadata, omgMessage: { ...base, renderKey: key } } };
}

/**
 * A reply drawn before the server has a row for it: the live draft, or the
 * copy the AI SDK assembled from this browser's own stream (it has no server
 * metadata at all). Streaming or finished.
 */
function isLocalReply(message: OmgChatMessage): boolean {
  if (message.role !== "assistant" || !message.parts.some((part) => part.type === "text")) return false;
  const meta = message.metadata?.omgMessage;
  return !meta || !!meta.draftOf;
}

function isPendingUserRow(message: OmgChatMessage): boolean {
  const meta = message.metadata?.omgMessage;
  return message.role === "user" && !!meta?.pending && !meta.failed && meta.kind === "text";
}

function sameReply(local: string, server: string): boolean {
  const a = normText(local);
  const b = normText(server);
  return !!a && (a === b || b.startsWith(a));
}

function messagesInTranscriptOrder(messages: OmgChatMessage[]): OmgChatMessage[] {
  // AbstractChat needs the live assistant at its array tail. The transcript
  // does not. Project that private write order into the server's visible
  // interrupt order without moving the SDK-owned array itself.
  const markerIndex = messages.findLastIndex(
    (message) =>
      message.role === "user" &&
      /^\[Request interrupted by user(?: for tool use)?\]$/i.test(textFromUIParts(message).trim()),
  );
  const pendingIndex = messages.reduce(
    (latest, message, index) =>
      message.role === "user" &&
      !!message.metadata?.omgMessage?.pending &&
      !message.metadata?.omgMessage?.queued &&
      (latest < 0 || messageTs(message) >= messageTs(messages[latest]!))
        ? index
        : latest,
    -1,
  );
  if (markerIndex < 0 && pendingIndex < 0 && !messages.some(isLocalReply)) return messages;

  if (markerIndex >= 0) {
    const next = [...messages];
    const markerMessage = messages[markerIndex]!;
    const markerTs = messageTs(markerMessage);
    // Only the answer the marker interrupted moves above it: one that started
    // before the marker was written. A reply drawn by this browser carries
    // its start time (startedAt); one without any time is the interrupted one
    // by elimination. An older marker, from an earlier steer still in the
    // history, used to pull every later streaming reply up to itself, far
    // above the prompt it answered, until the turn ended.
    const assistantIndex = messages.findIndex(
      (message, index) =>
        index > markerIndex &&
        message.role === "assistant" &&
        (messageTs(message) <= markerTs || (isStreamingAssistantText(message) && !messageTs(message))),
    );
    if (assistantIndex >= 0) {
      const [assistant] = next.splice(assistantIndex, 1);
      next.splice(markerIndex, 0, assistant!);
    }
    const pendingMessage = pendingIndex >= 0 ? messages[pendingIndex] : undefined;
    const pending = pendingMessage
      ? next.findIndex((message) => message.id === pendingMessage.id)
      : -1;
    const markerPosition = next.findIndex((message) => message.id === markerMessage.id);
    const pendingMoves = pending >= 0 && pending < markerPosition;
    if (pendingMoves) {
      const [message] = next.splice(pending, 1);
      const movedMarker = next.findIndex((candidate) => candidate.id === markerMessage.id);
      next.splice(movedMarker + 1, 0, message!);
    }
    if (assistantIndex >= 0 || pendingMoves) return next;
  }

  // Before the marker lands, a message sent while the reply ran goes after
  // the reply: the pending bubble, and also its confirmed row, which is
  // stamped after the reply started. Ordering the confirmed row by the pending
  // flag alone flipped it above the reply for the moment between the server
  // confirming it and writing the marker (or the reply finishing). Streaming
  // or finished: a reply with no server row yet sits at the array tail where
  // AbstractChat wrote it, whatever was sent while it ran.
  const assistantIndex = messages.findLastIndex(isLocalReply);
  if (assistantIndex < 0) return messages;
  const startedAt = messageTs(messages[assistantIndex]!);
  const steerIndex = messages.findIndex(
    (message, index) =>
      index < assistantIndex &&
      message.role === "user" &&
      !message.metadata?.omgMessage?.queued &&
      (index === pendingIndex || (startedAt > 0 && messageTs(message) > startedAt)),
  );
  if (steerIndex < 0) return messages;
  const next = [...messages];
  const [assistant] = next.splice(assistantIndex, 1);
  next.splice(steerIndex, 0, assistant!);
  return next;
}

function upsertOmgUIMessage(current: OmgChatMessage[], incoming: OmgChatMessage): OmgChatMessage[] {
  const byIdIndex = current.findIndex((message) => message.id === incoming.id);
  if (byIdIndex >= 0) {
    const previous = current[byIdIndex]!;
    incoming = adoptRowKey(incoming, omgRowKey(previous));
    if (previous === incoming) return current;
    const next = [...current];
    next[byIdIndex] = incoming;
    return next;
  }

  // The local row this server row confirms takes it over in place: your send
  // for a user turn, the live draft (or this browser's own streamed copy) for
  // a reply. Any other leftover draft is stale.
  const incomingLfg = incoming.metadata?.omgMessage;
  let confirmed = -1;
  let next = current;
  if (incomingLfg?.role === "user" && incomingLfg.kind === "text") {
    const incomingText = normText(incomingLfg.text);
    confirmed = current.findIndex(
      (message) => isPendingUserRow(message) && normText(message.metadata?.omgMessage?.text) === incomingText,
    );
  }
  if (incomingLfg?.role === "assistant" && incomingLfg.kind === "text") {
    const text = incomingLfg.text ?? "";
    confirmed = current.findLastIndex(
      (message) =>
        isLocalReply(message) &&
        sameReply(textFromUIParts(message), text),
    );
    // The server's live draft stands for whatever reply is being written, so
    // the finished row takes it over even when the texts differ. This
    // browser's own copy of an earlier reply is not this one: it stays, done,
    // and the next history page settles it. Dropping it here made an
    // interrupted answer vanish when the steered reply landed, and come back
    // when the history reloaded.
    if (confirmed < 0) confirmed = current.findLastIndex((message) => isStreamingAssistantText(message) && isServerDraft(message));
    next = finishStreamingCopies(
      current.filter((message, index) => index === confirmed || !(isStreamingAssistantText(message) && isServerDraft(message))),
    );
    if (confirmed >= 0) confirmed = next.findIndex((message) => message.id === current[confirmed]!.id);
  }
  // The server's row goes where the server's clock puts it (an interrupted
  // turn is ordered by the server, not by when this browser drew it). Moving
  // a row keeps its key, so React moves the element instead of replacing it.
  if (confirmed >= 0) {
    incoming = adoptRowKey(incoming, omgRowKey(next[confirmed]!));
    next = next.filter((_, index) => index !== confirmed);
  }

  const ts = messageTs(incoming);
  const insertAt =
    ts > 0
      ? next.findIndex((existing) => {
          const existingTs = messageTs(existing);
          return existingTs > 0 && existingTs > ts;
        })
      : -1;
  const out = [...next];
  if (insertAt >= 0) out.splice(insertAt, 0, incoming);
  else out.push(incoming);
  return out;
}

/** A reply drawn from the server's live draft (updateDraftText), not by this browser's own stream. */
function isServerDraft(message: OmgChatMessage): boolean {
  return !!message.metadata?.omgMessage?.draftOf;
}

/** This browser's own streamed replies, marked finished. Returns `messages` when none was streaming. */
function finishStreamingCopies(messages: OmgChatMessage[]): OmgChatMessage[] {
  let changed = false;
  const out = messages.map((message) => {
    if (!isStreamingAssistantText(message) || isServerDraft(message)) return message;
    changed = true;
    return {
      ...message,
      parts: message.parts.map((part) => (part.type === "text" ? { ...part, state: "done" as const } : part)),
    };
  });
  return changed ? out : messages;
}

function isStreamingAssistantText(message: OmgChatMessage): boolean {
  return (
    message.role === "assistant" &&
    message.parts.some((part) => part.type === "text" && part.state === "streaming")
  );
}

/**
 * Merge a freshly-fetched history page (the authoritative persisted read
 * model) with whatever the chat's local state already holds, on session
 * mount / re-entry.
 *
 * `current` can hold a streaming-draft assistant bubble left over from an
 * earlier visit to this same session id (useChat's state is keyed by id and
 * survives navigating away and back — see SessionChat). Normally that draft
 * is cleared the instant the turn's real "message" event arrives, via
 * upsertOmgUIMessage's own drop-stale-draft rule below. But if the app was
 * backgrounded (or the live subscription otherwise missed a beat) while the
 * turn finished, that clearing event never reached this client, so the stale
 * draft is still sitting in `current` when this history page lands — and the
 * page's `history` now contains the SAME turn, fully finalized, under its own
 * real id. Without this drop, both rendered: the finalized bubble from
 * `history` and the untouched streaming duplicate from `current`, back to
 * back, with identical text — this was bug 1's actual cause on iPad, where
 * Safari suspends a backgrounded tab's JS mid-turn.
 *
 * Dropping every local streaming draft here (not just ones matched to a
 * specific history row) mirrors upsertOmgUIMessage's own rule and is safe:
 * if a turn is still genuinely in progress, the live subscription's next
 * `ai_part` delta recreates the draft within moments — a brief gap beats a
 * permanent duplicate.
 */
export function mergeHistoryPage(
  current: OmgChatMessage[],
  history: OmgChatMessage[],
  olderKept: OmgChatMessage[],
  cachedIds: Set<string>,
): OmgChatMessage[] {
  const currentById = new Map(current.map((message) => [message.id, message]));
  // A row already on screen keeps its key when the page re-sends it.
  const page = history.map((message) => {
    const drawn = currentById.get(message.id);
    return drawn ? adoptRowKey(message, omgRowKey(drawn)) : message;
  });
  const historyIds = new Set(history.map((message) => message.id));
  const keptIds = new Set(olderKept.map((message) => message.id));
  // Messages that landed live while this fetch was in flight and aren't in
  // the page yet — they're newest, so they belong at the end. A stale
  // streaming draft is never "newest": either its turn is already reflected
  // in `history` (duplicate) or the live subscription will repaint it.
  const liveOnly = current.filter(
    (message) =>
      !historyIds.has(message.id) &&
      !keptIds.has(message.id) &&
      !isStreamingAssistantText(message),
  );
  // A local row the page confirms is replaced by the page's row, which takes
  // its key. Only rows the reader has not seen yet can confirm one, one each,
  // so a repeated identical message keeps its own row.
  const claimed = new Set<number>();
  const confirm = (matches: (row: OmgChatMessage) => boolean) => {
    const index = page.findIndex(
      (row, at) => !claimed.has(at) && !currentById.has(row.id) && matches(row),
    );
    if (index >= 0) claimed.add(index);
    return index;
  };
  const trailing: OmgChatMessage[] = [];
  for (const message of liveOnly) {
    if (isPendingUserRow(message)) {
      const text = normText(message.metadata?.omgMessage?.text);
      const index = confirm(
        (row) => row.role === "user" && row.metadata?.omgMessage?.kind === "text" && normText(row.metadata.omgMessage.text) === text,
      );
      if (index >= 0) {
        page[index] = adoptRowKey(page[index]!, omgRowKey(message));
        continue;
      }
    }
    if (isLocalReply(message)) {
      // Every row this reply drew must be on the page: its text parts as
      // assistant text rows, anything else (work, files) under its own id.
      const adopted: Array<[number, string]> = [];
      const settled = message.parts.every((part, at) => {
        if (part.type === "data-omgMessage") return historyIds.has(part.data.id ?? "");
        if (part.type !== "text") return true;
        const index = confirm(
          (row) =>
            row.role === "assistant" &&
            row.metadata?.omgMessage?.kind === "text" &&
            sameReply(part.text, row.metadata.omgMessage.text ?? ""),
        );
        if (index < 0) return false;
        adopted.push([index, textPartRowKey(message, at)]);
        return true;
      });
      if (settled && adopted.length) {
        for (const [index, key] of adopted) page[index] = adoptRowKey(page[index]!, key);
        continue;
      }
      for (const [index] of adopted) claimed.delete(index);
    }
    // A row from an earlier page that this page no longer has was removed.
    if (!cachedIds.has(message.id)) trailing.push(message);
  }
  return [...olderKept, ...page, ...trailing];
}

function omgQueueReconcileRow(message: OmgChatMessage): QueueReconcileMessage {
  return { id: message.id, role: message.role, ...message.metadata?.omgMessage };
}

/**
 * Rebuild queue-owned user bubbles from the server queue after a transcript
 * re-entry. Matching is one-to-one against the visible transcript (see
 * matchedQueueRowIds), so a repeated identical follow-up keeps its bubble
 * until its own row lands, and failed rows stay visible for retry.
 */
export function reconcileOmgQueueMessages(
  current: OmgChatMessage[],
  queue: OmgQueueMessage[],
  opts: { retainPendingQueueRows?: boolean } = {},
): OmgChatMessage[] {
  const visible = queue.filter(queueRowNeedsBubble);
  const visibleIds = new Set(visible.map((item) => queuedMessageId(item.id)));
  if (opts.retainPendingQueueRows) {
    for (const message of current) {
      if (
        message.id.startsWith(QUEUE_MESSAGE_ID_PREFIX) &&
        message.metadata?.omgMessage?.pending
      ) {
        visibleIds.add(message.id);
      }
    }
  }
  let next = current.filter(
    (message) => !message.id.startsWith(QUEUE_MESSAGE_ID_PREFIX) || visibleIds.has(message.id),
  );
  // A send the server held (queue mode, agent busy) is drawn ONCE. A send the
  // composer knew was waiting is a card under the composer and never had a
  // bubble. A send this page already drew as a bubble, because it thought the
  // agent was done while the server was still finishing the turn, stays that
  // bubble and turns into a waiting one, bound to the held row (`queueId`) so
  // the composer does not also show it as a card. It used to be dropped here
  // and reappear as a card, then as a bubble again when it was sent: one
  // message drawn in three places in a second.
  const held = queue
    .filter((item) => item.status === "held")
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  if (held.length) {
    const bound = new Set(
      next.map((message) => message.metadata?.omgMessage?.queueId).filter((id): id is string => !!id),
    );
    for (const item of held) {
      if (bound.has(item.id)) continue;
      const text = normText(item.text);
      const index = next.findIndex((message) => {
        if (message.id.startsWith(QUEUE_MESSAGE_ID_PREFIX) || !isPendingUserRow(message)) return false;
        const meta = message.metadata!.omgMessage!;
        return !meta.queueId && normText(meta.text) === text;
      });
      if (index < 0) continue;
      const bubble = next[index]!;
      next = [...next];
      next[index] = {
        ...bubble,
        metadata: {
          ...bubble.metadata,
          omgMessage: { ...bubble.metadata!.omgMessage!, queued: true, queueId: item.id },
        },
      };
      bound.add(item.id);
    }
  }
  const matched = matchedQueueRowIds(queue, next.map(omgQueueReconcileRow));
  const claimedOptimistic = new Set<number>();

  for (const item of visible) {
    const id = queuedMessageId(item.id);
    if (matched.has(item.id)) {
      next = next.filter((message) => message.id !== id);
      continue;
    }
    const existingIndex = next.findIndex((candidate) => candidate.id === id);
    const exactText = normText(item.text);
    const optimisticIndex =
      existingIndex >= 0
        ? -1
        : next.findIndex((candidate, index) => {
            if (claimedOptimistic.has(index)) return false;
            if (candidate.id.startsWith(QUEUE_MESSAGE_ID_PREFIX)) return false;
            const pending = candidate.metadata?.omgMessage;
            return (
              candidate.role === "user" &&
              !!pending?.pending &&
              !pending.failed &&
              pending?.kind === "text" &&
              normText(pending.text) === exactText
            );
          });

    // `queued` only ever goes on, never off, for as long as one bubble lives.
    // The send queue reports a message behind a running turn as pending, then
    // sending, then queued, and each of those is a separate event. Reading the
    // flag straight off the status made the bubble drop out of the queued rail
    // and back into the transcript between them, so a single mid-turn send
    // visibly flickered "queued → sending → queued" and re-ran its entrance
    // animation on every crossing. Delivery state is the server's; whether the
    // agent has read the text yet is not in doubt while the bubble exists.
    // A failed row still leaves the rail: queueRowHydration drops `pending`,
    // and splitQueuedRenderItems needs both flags.
    const replaced = next[existingIndex >= 0 ? existingIndex : optimisticIndex];
    const hydration = queueRowHydration(item);
    const renderKey =
      replaced?.metadata?.omgMessage?.renderKey ??
      replaced?.id ??
      id;
    const row: OmgMessage = {
      id,
      renderKey,
      role: "user",
      kind: "text",
      text: item.text,
      html: escapeHtml(item.text).replace(/\n/g, "<br>"),
      ts: item.createdAt ?? item.updatedAt ?? Date.now(),
      ...hydration,
      queued: hydration.queued || !!replaced?.metadata?.omgMessage?.queued,
    };
    const [message] = omgMessagesToUIMessages([row]);
    if (!message) continue;

    if (existingIndex >= 0) {
      // Refresh in place: the same row moves pending → queued → failed.
      next = [...next];
      next[existingIndex] = message;
      continue;
    }
    if (optimisticIndex >= 0) {
      claimedOptimistic.add(optimisticIndex);
      next = [...next];
      next[optimisticIndex] = message;
    } else {
      next = upsertOmgUIMessage(next, message);
    }
  }
  return next;
}

function updateDraftText(current: OmgChatMessage[], part: OmgAiStreamPart): OmgChatMessage[] {
  if (!part.id) return current;
  // The AI SDK chat stream accepts answer text. Reasoning is delivered later
  // as a typed transcript row and renders in the collapsed Thought control.
  if (part.kind === "thinking") return current;
  // The server names a session's draft the same for every turn, so the row is
  // named per turn: a finished reply keeps its draft's key (adoptRowKey), and
  // the next turn's draft must not draw under that key too.
  const existingIndex = current.findIndex(
    (message) =>
      message.role === "assistant" &&
      (message.metadata?.omgMessage?.draftOf ?? message.id) === part.id &&
      isStreamingAssistantText(message),
  );
  if (part.type === "text-end") {
    if (existingIndex < 0) return current;
    const existing = current[existingIndex];
    const nextMessage: OmgChatMessage = {
      ...existing,
      parts: existing.parts.map((item) =>
        item.type === "text" ? { ...item, state: "done" as const } : item,
      ),
    };
    const next = [...current];
    next[existingIndex] = nextMessage;
    return next;
  }
  if (part.type !== "text-delta" && part.type !== "text-start") return current;
  const incoming = part.reset ? (part.text ?? part.delta ?? "") : (part.delta ?? part.text ?? "");
  if (!incoming && existingIndex >= 0) return current;
  if (existingIndex >= 0) {
    const existing = current[existingIndex];
    const nextMessage: OmgChatMessage = {
      ...existing,
      metadata: {
        omgMessage: {
          ...(existing.metadata?.omgMessage ?? {}),
          id: existing.id,
          draftOf: part.id,
          role: "assistant",
          kind: "text",
          ts: part.ts ?? existing.metadata?.omgMessage?.ts ?? Date.now(),
        },
      },
      parts: existing.parts.map((item) =>
        item.type === "text"
          ? {
              ...item,
              text: part.reset ? incoming : `${item.text}${incoming}`,
              state: "streaming" as const,
            }
          : item,
      ),
    };
    const next = [...current];
    next[existingIndex] = nextMessage;
    return next;
  }
  if (!incoming) return current;
  const id = `${part.id}:${part.ts ?? Date.now()}`;
  return [
    ...current,
    {
      id,
      role: "assistant",
      metadata: {
        omgMessage: {
          id,
          draftOf: part.id,
          role: "assistant",
          kind: "text",
          text: incoming,
          ts: part.ts ?? Date.now(),
        },
      },
      parts: [{ type: "text", text: incoming, state: "streaming" }],
    },
  ];
}

/**
 * Restore the invariant AbstractChat writes under: while a local send owns the
 * live stream, the streaming assistant bubble is the LAST message.
 *
 * Every chunk of a live response is applied by comparing the response's own
 * message id against the tail of `chat.messages` — equal means replace the
 * tail, anything else means PUSH A FRESH COPY (see AbstractChat's
 * `replaceLastMessage`). So any row that lands past the streaming bubble makes
 * the very next chunk repeat the whole turn, under the SAME id.
 *
 * Sending WHILE the assistant is streaming does exactly that, twice over:
 * AbstractChat itself pushes the steering user message, and the runtime then
 * writes a synthetic "[Request interrupted by user]" row plus the echo of the
 * new turn — both role `user`, so both pass the `streamActive` filter below.
 * The transcript then painted the interrupted answer twice, once above the
 * interrupt divider and once below it. Under the virtualized transcript the
 * two copies also share a render-row key (the key is the message id), so they
 * were measured as one row and printed on top of each other.
 *
 * Dropping the older copies heals a duplicate that was pushed before any
 * transcript event could run; re-seating the survivor at the tail stops the
 * next chunk from minting another one. Both are no-ops on a healthy list, and
 * the array identity is preserved so the caller's `!==` guard still holds.
 */
function withStreamingTurnLast(messages: OmgChatMessage[]): OmgChatMessage[] {
  const lastIndexById = new Map<string, number>();
  messages.forEach((message, index) => lastIndexById.set(message.id, index));
  const deduped =
    lastIndexById.size === messages.length
      ? messages
      : messages.filter((message, index) => lastIndexById.get(message.id) === index);

  let streamingIndex = -1;
  for (let index = deduped.length - 1; index >= 0; index -= 1) {
    if (isStreamingAssistantText(deduped[index]!)) {
      streamingIndex = index;
      break;
    }
  }
  if (streamingIndex < 0 || streamingIndex === deduped.length - 1) return deduped;
  const streaming = deduped[streamingIndex]!;
  return [...deduped.slice(0, streamingIndex), ...deduped.slice(streamingIndex + 1), streaming];
}

export function appendOmgTranscriptEvent(
  current: OmgChatMessage[],
  event: OmgTranscriptEvent,
  opts: { streamActive?: boolean } = {},
): OmgChatMessage[] {
  const next = applyOmgTranscriptEvent(current, event, opts);
  if (!opts.streamActive) return next;
  const settled = withStreamingTurnLast(next);
  // Nothing moved and nothing was dropped: hand back the caller's own array so
  // an unchanged event stays a no-op.
  return settled.length === current.length && settled.every((message, index) => message === current[index])
    ? current
    : settled;
}

function applyOmgTranscriptEvent(
  current: OmgChatMessage[],
  event: OmgTranscriptEvent,
  opts: { streamActive?: boolean } = {},
): OmgChatMessage[] {
  if (event.type === "message") {
    if (event.message.seed) return current;
    if (opts.streamActive && event.message.role !== "user") return current;
    const [message] = omgMessagesToUIMessages([event.message]);
    return message ? upsertOmgUIMessage(current, message) : current;
  }
  if (event.type === "ai_part") {
    return opts.streamActive ? current : updateDraftText(current, event.part);
  }
  if (event.type === "queue") {
    return reconcileOmgQueueMessages(current, event.queue, {
      retainPendingQueueRows: opts.streamActive,
    });
  }
  if (event.type === "busy" && !event.busy) {
    // Turn ended. A live draft still marked streaming is stale: the server
    // never ends a draft explicitly, and its finished row is already here. A
    // reply this browser streamed itself is kept, finished, until the history
    // page settles it into its server row (mergeHistoryPage).
    const drafts = current.filter(
      (message) => !(isStreamingAssistantText(message) && isServerDraft(message)),
    );
    const settled = finishStreamingCopies(drafts);
    return settled.length === current.length && settled.every((message, index) => message === current[index])
      ? current
      : settled;
  }
  return current;
}

// The stream handed back to a steering send that is riding an already-open live
// stream. It carries no chunks, so the AI SDK adds no second assistant message
// and settles the send immediately.
function emptyChunkStream(): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start: (controller) => controller.close(),
  });
}

class OmgChunkEmitter {
  private activeTextIds = new Set<string>();
  private textById: Record<string, string> = {};
  private closed = false;
  private sawContent = false;
  private stamped = false;
  private createdAt = Date.now();
  private finishTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private controller: ReadableStreamDefaultController<UIMessageChunk>,
    private onClose?: () => void,
  ) {}

  handle(event: OmgTranscriptEvent) {
    if (this.closed) return;
    if (event.type === "error") {
      this.enqueue({ type: "error", errorText: event.error });
      this.close();
      return;
    }
    if (event.type === "busy") {
      // busy:false only ends the stream promptly once we've actually seen
      // content. The serve's 1s poll re-emits the CURRENT (still idle) busy
      // state right after a send — the old 500ms grace let that pre-flip frame
      // close the stream with zero content, dropping chatStatus to "ready" so
      // the working indicator never appeared. A content-less stream still gets
      // a long-grace close so an interrupted/failed turn can't wedge the
      // composer, and busy:true cancels any pending close.
      if (event.busy) this.clearFinishTimer();
      else if (this.sawContent) this.finishSoon();
      else this.finishSoon(15_000);
      return;
    }
    if (event.type === "ai_part") {
      this.handlePart(event.part);
      return;
    }
    if (event.type === "queue" || event.type === "snapshot") return;
    this.handleMessage(event.message);
  }

  abort(reason?: string) {
    if (this.closed) return;
    this.enqueue({ type: "abort", reason });
    this.close();
  }

  private handlePart(part: OmgAiStreamPart) {
    if (!part.id) return;
    // Do not turn a provider reasoning draft into a normal assistant answer.
    // The finalized thinking row arrives through handleMessage instead.
    if (part.kind === "thinking") return;
    if (part.type === "text-end") {
      this.endText(part.id);
      this.finishSoon();
      return;
    }
    if (part.type === "error") {
      this.enqueue({ type: "error", errorText: part.text || part.delta || "streaming error" });
      this.close();
      return;
    }
    if (part.type !== "text-delta" && part.type !== "text-start") return;
    const incoming = part.reset ? (part.text ?? part.delta ?? "") : (part.delta ?? part.text ?? "");
    const current = this.textById[part.id] ?? "";
    let delta = incoming;
    if (part.reset && current) {
      // A reset is a full snapshot of the draft, not another delta. The AI SDK
      // stream protocol is append-only, so forward only the newly-grown suffix.
      // Replaying the whole snapshot made the live bubble repeat once per poll;
      // a reload appeared to fix it because indexed history contains one row.
      if (!incoming.startsWith(current)) return;
      delta = incoming.slice(current.length);
    }
    this.stampStart(part.ts);
    if (part.type === "text-start" && !this.activeTextIds.has(part.id)) this.startText(part.id);
    if (!incoming || !delta) return;
    if (!this.activeTextIds.has(part.id)) this.startText(part.id);
    this.textById[part.id] = part.reset ? incoming : `${current}${incoming}`;
    this.enqueue({ type: "text-delta", id: part.id, delta });
  }

  private handleMessage(message: OmgMessage) {
    if (message.role === "user" && message.kind === "text") return;
    this.stampStart(message.ts);
    this.sawContent = true;
    this.clearFinishTimer();
    if (message.role === "assistant" && message.kind === "text") {
      const text = message.text ?? "";
      const active = [...this.activeTextIds][0];
      if (active) {
        const current = this.textById[active] ?? "";
        if (text.startsWith(current) && text.length > current.length) {
          this.enqueue({ type: "text-delta", id: active, delta: text.slice(current.length) });
          this.textById[active] = text;
        }
        this.endText(active);
      } else if (text) {
        const id = message.id ?? `assistant-${message.ts ?? Date.now()}`;
        this.startText(id);
        this.enqueue({ type: "text-delta", id, delta: text });
        this.textById[id] = text;
        this.endText(id);
      }
      this.finishSoon();
      return;
    }
    this.enqueue({ type: "data-omgMessage", id: message.id, data: message });
  }

  // Stamp the reply this stream assembles with the server time it started,
  // once (see OmgChatMetadata.startedAt).
  private stampStart(ts: number | undefined) {
    if (this.stamped) return;
    this.stamped = true;
    this.enqueue({ type: "message-metadata", messageMetadata: { startedAt: ts ?? Date.now() } });
  }

  private startText(id: string) {
    this.sawContent = true;
    this.clearFinishTimer();
    this.activeTextIds.add(id);
    this.enqueue({ type: "text-start", id });
  }

  private endText(id: string) {
    if (!this.activeTextIds.delete(id)) return;
    this.enqueue({ type: "text-end", id });
  }

  private finishSoon(delayMs = 80) {
    this.clearFinishTimer();
    this.finishTimer = setTimeout(() => {
      for (const id of [...this.activeTextIds]) this.endText(id);
      this.enqueue({ type: "finish", finishReason: "stop" });
      this.close();
    }, delayMs);
  }

  private clearFinishTimer() {
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = null;
  }

  private enqueue(chunk: UIMessageChunk) {
    if (this.closed) return;
    this.controller.enqueue(chunk);
  }

  private close() {
    if (this.closed) return;
    this.clearFinishTimer();
    this.closed = true;
    this.controller.close();
    this.onClose?.();
  }
}

export type OmgChatSendCallbacks = {
  onAccepted?: () => void;
  onRejected?: (error: unknown) => void;
};

function notifySend(callback: (() => void) | undefined) {
  try { callback?.(); } catch (error) { console.warn("Chat send callback failed", error); }
}

export class OmgChatTransport implements ChatTransport<OmgChatMessage> {
  private readonly subscribeTranscript?: OmgTranscriptSubscribe;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly apiBase: string;
  private readonly usesConfiguredTransport: boolean;
  private readonly sessionId: string;
  private readonly sendEndpoint: string;
  private readonly viewerIdentity: string | undefined;
  // Live emitters held by this transport. See sendMessages: at most one, ever.
  // Scoped to the instance rather than to the session id on purpose — a stream
  // that is created and then never consumed would otherwise hold a global slot
  // forever, muting the session; here it dies with the transport.
  private liveStreams = 0;

  constructor({ sessionId, sendEndpoint, apiBase = "", subscribeTranscript, fetch: fetchImpl, viewerIdentity }: OmgChatTransportOptions) {
    this.sessionId = sessionId;
    this.viewerIdentity = viewerIdentity?.trim() || undefined;
    this.sendEndpoint = sendEndpoint ?? `/api/sessions/${encodeURIComponent(sessionId)}/send`;
    this.apiBase = apiBase;
    this.subscribeTranscript = subscribeTranscript;
    // The embedded app's host owns auth and routing through configureOmgTransport.
    // Falling back to window.fetch here bypassed that boundary and sent composer
    // POSTs to the host page's origin (app.omg.dev) instead of the selected LFG
    // instance. Use the configured transport whenever no explicit low-level
    // fetch/base override was requested; standalone LFG's configured default is
    // already the same-origin transport.
    this.usesConfiguredTransport = !fetchImpl && !apiBase;
    this.fetchImpl = fetchImpl ?? (this.usesConfiguredTransport
      ? omgFetch
      : globalThis.fetch.bind(globalThis));
  }

  async sendMessages({
    messages,
    abortSignal,
    body,
    metadata,
  }: Parameters<ChatTransport<OmgChatMessage>["sendMessages"]>[0]): Promise<ReadableStream<UIMessageChunk>> {
    const text = this.extractLatestUserText(messages);
    if (!text) throw new Error("Cannot send an empty message");
    // Steering — a second send while the previous turn is still streaming — must
    // NOT open a second live stream. AbstractChat keeps one `activeResponse` per
    // call but a single `lastMessage`, and every stream write picks
    // replace-vs-append by comparing its own message id against the tail of the
    // list. Two concurrent responses therefore each find the OTHER one's message
    // at the tail on every chunk and push a fresh copy of themselves instead of
    // replacing — so one steered turn repeats its whole
    // thinking + tools + text group down the transcript, once per chunk, until
    // the turn ends. (The AI SDK neither serializes nor aborts the first
    // response; `makeRequest` just overwrites `this.activeResponse`.)
    //
    // A single emitter is also what the design already means: it subscribes to
    // the SESSION, not to this individual send, so the stream that is already
    // open renders the steered turn too. The extra send only needs to reach the
    // server, and its (empty) stream resolves immediately.
    // `passive`: the caller is joining a turn it did not start, which the
    // passive transcript listener is already drawing. A stream opened now
    // would only see the reply from this moment on (see sendIntoChat in
    // App.tsx), so the send only has to reach the server.
    const passive = (body as { passive?: boolean } | undefined)?.passive === true;
    const live = this.liveStreams === 0 && !passive ? this.createLiveStream(abortSignal) : null;
    try {
      const response = await this.fetchImpl(this.requestTarget(this.sendEndpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          mode: (body as { mode?: string } | undefined)?.mode,
          ...(this.viewerIdentity ? { user: this.viewerIdentity } : {}),
        }),
        signal: abortSignal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || `${response.status} ${response.statusText}`);
      }
    } catch (error) {
      // Nothing will ever consume this stream, so release the subscription and
      // the slot here — otherwise one failed send would leave liveStreams stuck
      // above zero and silently mute every later turn in this session.
      live?.release();
      const onRejected = (metadata as OmgChatSendCallbacks | undefined)?.onRejected;
      if (onRejected) notifySend(() => onRejected(error));
      throw error;
    }
    // A send is accepted at the HTTP response, before the agent's stream
    // finishes. The AI SDK send promise can also resolve after a caught error,
    // so it cannot serve as an acknowledgement for guide progression.
    notifySend((metadata as OmgChatSendCallbacks | undefined)?.onAccepted);
    return live ? live.stream : emptyChunkStream();
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }

  // Claims this transport's single live-stream slot and holds it until the
  // emitter closes, the consumer cancels, or the caller releases it.
  private createLiveStream(abortSignal?: AbortSignal): {
    stream: ReadableStream<UIMessageChunk>;
    release: () => void;
  } {
    let unsubscribe: (() => void) | null = null;
    let emitter: OmgChunkEmitter | null = null;
    let released = false;
    const sid = this.sessionId;
    this.liveStreams += 1;
    const release = () => {
      if (released) return;
      released = true;
      this.liveStreams -= 1;
      unsubscribe?.();
      unsubscribe = null;
      emitter = null;
    };
    const stream = new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        if (!this.subscribeTranscript) {
          controller.enqueue({ type: "error", errorText: "live transcript subscription is unavailable" });
          controller.close();
          release();
          return;
        }
        emitter = new OmgChunkEmitter(controller, release);
        unsubscribe = this.subscribeTranscript(sid, (event) => emitter?.handle(event));
        abortSignal?.addEventListener("abort", () => {
          const active = emitter;
          release();
          active?.abort("aborted");
        }, { once: true });
      },
      cancel: release,
    });
    return { stream, release };
  }

  private extractLatestUserText(messages: OmgChatMessage[]) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role !== "user") continue;
      const text = textFromUIParts(message).trim();
      if (text) return text;
    }
    return "";
  }

  private requestTarget(path: string) {
    if (this.usesConfiguredTransport) return path;
    return new URL(path, this.apiBase || (typeof location !== "undefined" ? location.origin : "http://127.0.0.1:8766")).toString();
  }
}
