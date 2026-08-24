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
};

export type OmgAiStreamPart = {
  type: "text-delta" | "text-start" | "text-end" | "error" | string;
  id?: string;
  delta?: string;
  text?: string;
  reset?: boolean;
  ts?: number;
};

export type OmgQueueMessage = {
  id: string;
  text: string;
  status: "pending" | "sending" | "queued" | "failed" | "delivered";
  error?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type OmgChatMetadata = {
  omgMessage?: OmgMessage;
};

export type OmgChatDataParts = {
  omgMessage: OmgMessage;
};

export type OmgChatMessage = UIMessage<OmgChatMetadata, OmgChatDataParts>;

export type OmgTranscriptEvent =
  | { type: "message"; message: OmgMessage }
  | { type: "ai_part"; part: OmgAiStreamPart }
  | { type: "queue"; queue: OmgQueueMessage[] }
  | { type: "busy"; busy: boolean }
  | { type: "error"; error: string };

export type OmgTranscriptSubscribe = (
  sid: string,
  listener: (event: OmgTranscriptEvent) => void,
) => () => void;

const EMPTY_HELD: OmgMessage[] = [];

// A focused chat consumes transcript events twice: once through useChat's
// transport and once through the passive subscription that also handles turns
// started outside this browser. The transport must claim a locally-started
// stream before it can emit its first event; React status is intentionally not
// involved because its render notification can lag behind that event.
export class OmgChatStreamOwnership {
  readonly #counts = new Map<string, number>();
  readonly #held = new Map<string, OmgMessage[]>();

  owns(sid: string): boolean {
    return (this.#counts.get(sid) ?? 0) > 0;
  }

  /**
   * Park a transcript row that must NOT enter the message list yet.
   *
   * While a local send owns the live stream, AbstractChat requires its own
   * streaming assistant message to be the LAST entry of the list, and it
   * re-asserts that on every chunk (see withStreamingTurnLast). A row that
   * chronologically belongs BEFORE the streaming turn therefore cannot be
   * inserted while the stream runs: either it displaces the streaming bubble
   * and mints a duplicate turn, or the bubble is re-seated past it and the
   * reader sees the rows in the wrong order.
   *
   * So the row waits here, in arrival order, which IS the server's
   * chronological order, and is committed verbatim once the stream releases.
   */
  hold(sid: string, message: OmgMessage): void {
    const queue = this.#held.get(sid);
    if (queue) queue.push(message);
    else this.#held.set(sid, [message]);
  }

  /** Take everything parked for this session. Empty for the common path. */
  release(sid: string): OmgMessage[] {
    const queue = this.#held.get(sid);
    if (!queue) return EMPTY_HELD;
    this.#held.delete(sid);
    return queue;
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
};

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);
}

function normText(value?: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function messageTs(message: OmgChatMessage) {
  return message.metadata?.omgMessage?.ts ?? 0;
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
  const out: OmgMessage[] = [];
  for (const message of messages) {
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
      const id =
        index === 0
          ? streaming
            ? `draft-${message.id}`
            : message.id
          : `${streaming ? "draft-" : ""}${message.id}-text-${index}`;
      out.push({
        ...base,
        id,
        role: message.role,
        kind: "text",
        text: part.text,
        html: message.role === "user" ? escapeHtml(part.text).replace(/\n/g, "<br>") : base?.html,
        pending: base?.pending,
        queued: base?.queued,
        catchUp: base?.catchUp,
      });
    });
  }
  return out.filter((message) => message.kind !== "text" || !!message.text || message.role !== "assistant");
}

function upsertOmgUIMessage(current: OmgChatMessage[], incoming: OmgChatMessage): OmgChatMessage[] {
  const byIdIndex = current.findIndex((message) => message.id === incoming.id);
  if (byIdIndex >= 0) {
    if (current[byIdIndex] === incoming) return current;
    const next = [...current];
    next[byIdIndex] = incoming;
    return next;
  }

  let next = current;
  const incomingLfg = incoming.metadata?.omgMessage;
  if (incomingLfg?.role === "user" && incomingLfg.kind === "text") {
    const incomingText = normText(incomingLfg.text);
    const pendingIndex = current.findIndex((message) => {
      const lfg = message.metadata?.omgMessage;
      return (
        message.role === "user" &&
        !!lfg?.pending &&
        lfg.kind === "text" &&
        normText(lfg.text) === incomingText
      );
    });
    if (pendingIndex >= 0) {
      next = [...current];
      next[pendingIndex] = incoming;
      return next;
    }
  }

  if (incomingLfg?.role === "assistant" && incomingLfg.kind === "text") {
    next = current.filter((message) => {
      if (message.role !== "assistant") return true;
      return !message.parts.some((part) => part.type === "text" && part.state === "streaming");
    });
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
  const trailing = liveOnly.filter((message) => !cachedIds.has(message.id));
  return [...olderKept, ...history, ...trailing];
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
): OmgChatMessage[] {
  const visible = queue.filter(queueRowNeedsBubble);
  const visibleIds = new Set(visible.map((item) => queuedMessageId(item.id)));
  let next = current.filter(
    (message) => !message.id.startsWith(QUEUE_MESSAGE_ID_PREFIX) || visibleIds.has(message.id),
  );
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
    const row: OmgMessage = {
      id,
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
  const existingIndex = current.findIndex(
    (message) =>
      message.role === "assistant" &&
      message.parts.some((item) => item.type === "text" && message.id === part.id),
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
          id: part.id,
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
  return [
    ...current,
    {
      id: part.id,
      role: "assistant",
      metadata: {
        omgMessage: {
          id: part.id,
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

/**
 * The row an event carries that must survive an owned stream rather than be
 * dropped by it.
 *
 * Only user rows qualify. Everything else the runtime writes during a turn is
 * already reaching the transcript through the AI SDK stream itself, so holding
 * it would paint it twice. A user row is the opposite case: OmgChunkEmitter
 * skips user text on purpose, so the passive listener is its only route in.
 */
export function heldRowDuringOwnedStream(event: OmgTranscriptEvent): OmgMessage | null {
  if (event.type !== "message") return null;
  if (event.message.seed) return null;
  return event.message.role === "user" ? event.message : null;
}

/**
 * Commit the rows a live turn parked, in the order the server sent them.
 *
 * Deliberately NOT upsertOmgUIMessage: that inserts by timestamp, and a
 * timestamp is the wrong key here. Nothing on the wire carries the server's
 * ordering column (`order_seq` in src/transcript-index.ts) — `ts` is a wall
 * clock stamped by whichever process wrote the row, so sorting by it makes
 * transcript order depend on the browser's clock agreeing with the server's.
 * These rows arrived in the server's own order and are by construction the
 * newest, so arrival order at the tail IS the server's order.
 *
 * The one thing that does move is the optimistic bubble the send put up: its
 * echo takes its place at the tail rather than in the slot AbstractChat
 * happened to append it to, which is what puts the steering message BELOW the
 * answer it interrupted instead of above it.
 */
export function commitHeldOmgRows(
  current: OmgChatMessage[],
  rows: readonly OmgMessage[],
): OmgChatMessage[] {
  let next = current;
  for (const row of rows) {
    const [message] = omgMessagesToUIMessages([row]);
    if (message) next = appendHeldRow(next, message);
  }
  return next;
}

function appendHeldRow(current: OmgChatMessage[], incoming: OmgChatMessage): OmgChatMessage[] {
  const byIdIndex = current.findIndex((message) => message.id === incoming.id);
  if (byIdIndex >= 0) {
    if (current[byIdIndex] === incoming) return current;
    const next = [...current];
    next[byIdIndex] = incoming;
    return next;
  }
  let next = current;
  const incomingLfg = incoming.metadata?.omgMessage;
  if (incomingLfg?.role === "user" && incomingLfg.kind === "text") {
    const incomingText = normText(incomingLfg.text);
    const pendingIndex = current.findIndex((message) => {
      const lfg = message.metadata?.omgMessage;
      return (
        message.role === "user" &&
        !!lfg?.pending &&
        lfg.kind === "text" &&
        normText(lfg.text) === incomingText
      );
    });
    if (pendingIndex >= 0) next = current.filter((_, index) => index !== pendingIndex);
  }
  return [...next, incoming];
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
    // No transcript row may enter the list while a local send owns the live
    // stream. Assistant rows are already being painted by the AI SDK from the
    // same stream, and user rows have to wait: see OmgChatStreamOwnership.hold.
    if (opts.streamActive) return current;
    const [message] = omgMessagesToUIMessages([event.message]);
    return message ? upsertOmgUIMessage(current, message) : current;
  }
  if (event.type === "ai_part") {
    return opts.streamActive ? current : updateDraftText(current, event.part);
  }
  if (event.type === "queue") return reconcileOmgQueueMessages(current, event.queue);
  if (event.type === "busy" && !event.busy) {
    // Turn ended: any assistant message still marked streaming is a stale
    // draft. The server never emits an explicit end for drafts (it just stops
    // sending deltas — heavy on claude, rare on codex), and the finalized row
    // for the same text is already indexed/upserted, so a leftover streaming
    // bubble would sit there animating forever.
    const next = current.filter(
      (message) =>
        message.role !== "assistant" ||
        !message.parts.some((part) => part.type === "text" && part.state === "streaming"),
    );
    return next.length === current.length ? current : next;
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
    if (event.type === "queue") return;
    this.handleMessage(event.message);
  }

  abort(reason?: string) {
    if (this.closed) return;
    this.enqueue({ type: "abort", reason });
    this.close();
  }

  private handlePart(part: OmgAiStreamPart) {
    if (!part.id) return;
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
    if (part.type === "text-start" && !this.activeTextIds.has(part.id)) this.startText(part.id);
    if (!incoming || !delta) return;
    if (!this.activeTextIds.has(part.id)) this.startText(part.id);
    this.textById[part.id] = part.reset ? incoming : `${current}${incoming}`;
    this.enqueue({ type: "text-delta", id: part.id, delta });
  }

  private handleMessage(message: OmgMessage) {
    if (message.role === "user" && message.kind === "text") return;
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

export class OmgChatTransport implements ChatTransport<OmgChatMessage> {
  private readonly subscribeTranscript?: OmgTranscriptSubscribe;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly apiBase: string;
  private readonly usesConfiguredTransport: boolean;
  private readonly sessionId: string;
  private readonly sendEndpoint: string;
  // Live emitters held by this transport. See sendMessages: at most one, ever.
  // Scoped to the instance rather than to the session id on purpose — a stream
  // that is created and then never consumed would otherwise hold a global slot
  // forever, muting the session; here it dies with the transport.
  private liveStreams = 0;

  constructor({ sessionId, sendEndpoint, apiBase = "", subscribeTranscript, fetch: fetchImpl }: OmgChatTransportOptions) {
    this.sessionId = sessionId;
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
    const live = this.liveStreams === 0 ? this.createLiveStream(abortSignal) : null;
    try {
      const response = await this.fetchImpl(this.requestTarget(this.sendEndpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mode: (body as { mode?: string } | undefined)?.mode }),
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
      throw error;
    }
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
