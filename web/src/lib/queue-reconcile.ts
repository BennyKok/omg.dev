// Shared send-queue reconciliation for the live transcript views.
//
// The server streams the full outbound send queue on every change. Each view
// (the WS hook, the SSE hook, and the AI-SDK transport) hydrates queue rows
// into user bubbles so a message written while the agent was mid-turn survives
// navigation and server restarts. Three rules keep that hydration truthful:
//
// 1. One-to-one: each transcript user row satisfies exactly one queue row,
//    oldest first. Two identical queued messages must each claim their own
//    row — sharing one would drop a follow-up the agent has not read yet.
// 2. Failed rows stay visible with their error until the user retries or
//    clears them. They never claim a transcript row, because their text never
//    landed.
// 3. A queue event must never truncate paged history: the caller's list can
//    hold far more than one page of transcript rows.

import { api } from "./omg-client";

export type QueueMessageRow = {
  id: string;
  text: string;
  status: "pending" | "sending" | "queued" | "failed" | "delivered";
  error?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type QueueReconcileMessage = {
  id?: string;
  role?: string;
  kind?: string;
  text?: string;
  ts?: number;
  pending?: boolean;
  queued?: boolean;
  failed?: boolean;
  queueError?: string;
  queueId?: string;
};

export const QUEUE_MESSAGE_ID_PREFIX = "queue-";

export function queuedMessageId(id: string): string {
  return `${QUEUE_MESSAGE_ID_PREFIX}${id}`;
}

function normText(value?: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

// Statuses that still need a bubble in the transcript. Delivered rows are
// dropped (their real transcript row renders instead); failed rows stay so the
// user can see the error and retry.
const BUBBLE_STATUSES = new Set(["pending", "sending", "queued", "failed"]);

export function queueRowNeedsBubble(item: QueueMessageRow): boolean {
  return BUBBLE_STATUSES.has(item.status);
}

// Which queue rows already have their own user row in the visible transcript?
// Oldest queue row first, each transcript row claimed at most once, and a row
// must not predate its send — that is what keeps a repeated identical
// follow-up visible until its own row lands. Failed rows are excluded: their
// text never landed, so there is nothing to claim, and an identical older row
// must not hide the failure.
export function matchedQueueRowIds(
  queue: QueueMessageRow[],
  rows: QueueReconcileMessage[],
): Set<string> {
  const claimed = new Set<number>();
  const matched = new Set<string>();
  const ordered = queue
    .filter((item) => item.status !== "failed")
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  for (const item of ordered) {
    const text = normText(item.text);
    if (!text || !item.createdAt) continue;
    const index = rows.findIndex(
      (row, i) =>
        !claimed.has(i) &&
        row.role === "user" &&
        row.kind === "text" &&
        !row.pending &&
        !row.failed &&
        normText(row.text) === text &&
        (row.ts ?? 0) >= item.createdAt! - 1_000,
    );
    if (index < 0) continue;
    claimed.add(index);
    matched.add(item.id);
  }
  return matched;
}

// The fields a hydrated queue bubble carries. A failed row is deliberately not
// `pending`: nothing is in flight, so no shimmer — the bubble records a send
// that did not land, with the server-side error and the id retry needs.
export function queueRowHydration(
  item: QueueMessageRow,
): Pick<QueueReconcileMessage, "pending" | "queued" | "failed" | "queueError" | "queueId"> {
  if (item.status === "failed") {
    return { failed: true, queueError: item.error, queueId: item.id };
  }
  return { pending: true, queued: item.status === "queued" };
}

/**
 * Fold a queue snapshot into the visible message list. `hydrate` builds one
 * bubble row per queue message in the caller's own message shape. The list is
 * returned at whatever length the caller had — paging history further back
 * must survive every queue event.
 */
export function reconcileQueueMessages<T extends QueueReconcileMessage>(
  current: T[],
  queue: QueueMessageRow[],
  hydrate: (item: QueueMessageRow) => T,
): T[] {
  const visible = queue.filter(queueRowNeedsBubble);
  const visibleIds = new Set(visible.map((item) => queuedMessageId(item.id)));
  let next = current.filter(
    (message) => !message.id?.startsWith(QUEUE_MESSAGE_ID_PREFIX) || visibleIds.has(message.id),
  );
  const matched = matchedQueueRowIds(queue, next);
  const claimedOptimistic = new Set<number>();
  for (const item of visible) {
    const id = queuedMessageId(item.id);
    if (matched.has(item.id)) {
      next = next.filter((message) => message.id !== id);
      continue;
    }
    const hydrated = hydrate(item);
    const existingIndex = next.findIndex((message) => message.id === id);
    if (existingIndex >= 0) {
      // Refresh in place: the same row moves pending → queued → failed.
      next = [...next];
      next[existingIndex] = hydrated;
      continue;
    }
    const text = normText(item.text);
    const optimisticIndex = next.findIndex(
      (message, i) =>
        !claimedOptimistic.has(i) &&
        !message.id?.startsWith(QUEUE_MESSAGE_ID_PREFIX) &&
        message.role === "user" &&
        message.kind === "text" &&
        message.pending &&
        !message.failed &&
        normText(message.text) === text,
    );
    if (optimisticIndex >= 0) {
      claimedOptimistic.add(optimisticIndex);
      next = [...next];
      next[optimisticIndex] = hydrated;
    } else {
      next = [...next, hydrated];
    }
  }
  return next;
}

/**
 * Re-queue a failed send through the existing retry endpoint. The next queue
 * event repaints the bubble as pending; delivery proceeds from there.
 */
export async function retryQueuedMessage(
  sessionId: string,
  queueId: string,
  request: <T>(path: string, init?: RequestInit) => Promise<unknown> = api,
): Promise<void> {
  await request(
    `/api/sessions/${encodeURIComponent(sessionId)}/queue/${queueId}/retry`,
    { method: "POST" },
  );
}
