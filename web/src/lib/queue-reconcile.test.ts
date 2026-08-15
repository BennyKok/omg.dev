import { describe, expect, test } from "bun:test";
import {
  matchedQueueRowIds,
  reconcileQueueMessages,
  retryQueuedMessage,
  type QueueMessageRow,
  type QueueReconcileMessage,
} from "./queue-reconcile";

// The queue event carries the full server-side send queue; the view folds it
// into the visible transcript. These tests pin the three rules the module
// documents: one-to-one matching for repeated identical messages, failed rows
// stay visible for retry, and a queue event never truncates paged history.

const TS = 1786185318060;

type Row = QueueReconcileMessage & { html?: string };

function transcriptUser(text: string, ts: number, id?: string): Row {
  return { id: id ?? `row-${ts}`, role: "user", kind: "text", text, ts };
}

function queueRow(
  id: string,
  text: string,
  status: QueueMessageRow["status"],
  createdAt: number,
  error?: string,
): QueueMessageRow {
  return { id, text, status, createdAt, updatedAt: createdAt, ...(error ? { error } : {}) };
}

function hydrate(item: QueueMessageRow): Row {
  return {
    id: `queue-${item.id}`,
    role: "user",
    kind: "text",
    text: item.text,
    ts: item.createdAt ?? item.updatedAt,
    ...(item.status === "failed"
      ? { failed: true, queueError: item.error, queueId: item.id }
      : { pending: true, queued: item.status === "queued" }),
  };
}

describe("reconcileQueueMessages", () => {
  test("keeps a later identical follow-up visible until its own row lands", () => {
    // Two identical sends; only the first has reached the transcript.
    const current: Row[] = [transcriptUser("looks good", TS)];
    const queue = [
      queueRow("a", "looks good", "queued", TS - 100),
      queueRow("b", "looks good", "queued", TS - 50),
    ];

    const next = reconcileQueueMessages(current, queue, hydrate);

    // The first queue row claims the transcript row and drops its bubble; the
    // second keeps its own.
    expect(next.some((m) => m.id === "queue-a")).toBe(false);
    expect(next.some((m) => m.id === "queue-b")).toBe(true);
  });

  test("a delivered row still claims its transcript row", () => {
    // The server already promoted the first send; without delivered rows
    // claiming their rows, the second send's bubble would match the same
    // transcript row and vanish.
    const current: Row[] = [transcriptUser("yes", TS)];
    const queue = [
      queueRow("a", "yes", "delivered", TS - 100),
      queueRow("b", "yes", "queued", TS - 50),
    ];

    const next = reconcileQueueMessages(current, queue, hydrate);

    expect(next.some((m) => m.id === "queue-b")).toBe(true);
  });

  test("drops both bubbles once both identical rows landed", () => {
    const current: Row[] = [
      transcriptUser("looks good", TS),
      transcriptUser("looks good", TS + 5_000),
    ];
    const queue = [
      queueRow("a", "looks good", "queued", TS - 100),
      queueRow("b", "looks good", "queued", TS + 4_000),
    ];

    const next = reconcileQueueMessages(current, queue, hydrate);

    expect(next.filter((m) => m.id?.startsWith("queue-"))).toHaveLength(0);
  });

  test("hydrates a failed row with its error and retry id", () => {
    const next = reconcileQueueMessages(
      [],
      [queueRow("a", "deploy it", "failed", TS, "message never left the input box after retries")],
      hydrate,
    );

    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      id: "queue-a",
      role: "user",
      failed: true,
      queueError: "message never left the input box after retries",
      queueId: "a",
    });
    expect(next[0].pending).toBeUndefined();
    expect(next[0].queued).toBeUndefined();
  });

  test("a failed row does not claim an identical transcript row", () => {
    // The user typed the same text into the terminal by hand after the
    // failure; the failed bubble must still show its error rather than
    // silently resolving against a row its send never produced.
    const current: Row[] = [transcriptUser("deploy it", TS + 60_000)];
    const queue = [queueRow("a", "deploy it", "failed", TS, "boom")];

    const next = reconcileQueueMessages(current, queue, hydrate);

    expect(next.some((m) => m.id === "queue-a" && m.failed)).toBe(true);
  });

  test("refreshes a hydrated row in place when its status changes", () => {
    const pending = reconcileQueueMessages([], [queueRow("a", "hi", "pending", TS)], hydrate);
    const failed = reconcileQueueMessages(
      pending,
      [queueRow("a", "hi", "failed", TS, "boom")],
      hydrate,
    );

    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ id: "queue-a", failed: true, queueError: "boom" });
  });

  test("claims one optimistic bubble per queue row when texts repeat", () => {
    const current: Row[] = [
      { id: "optimistic-1", role: "user", kind: "text", text: "go", ts: TS, pending: true },
      { id: "optimistic-2", role: "user", kind: "text", text: "go", ts: TS + 10, pending: true },
    ];
    const queue = [queueRow("a", "go", "sending", TS)];

    const next = reconcileQueueMessages(current, queue, hydrate);

    // The first optimistic bubble becomes the queue row; the second identical
    // optimistic bubble is left for its own queue row.
    expect(next.map((m) => m.id)).toEqual(["queue-a", "optimistic-2"]);
  });

  test("never truncates paged-in history beyond one page", () => {
    const current: Row[] = Array.from({ length: 120 }, (_, i) => ({
      id: `row-${i}`,
      role: i % 2 ? "assistant" : "user",
      kind: "text",
      text: `message ${i}`,
      ts: TS + i,
    }));

    const next = reconcileQueueMessages(
      current,
      [queueRow("a", "still waiting", "queued", TS + 200)],
      hydrate,
    );

    expect(next).toHaveLength(121);
    expect(next[0].id).toBe("row-0");
    expect(next.at(-1)?.id).toBe("queue-a");
  });
});

describe("matchedQueueRowIds", () => {
  test("ignores a transcript row that predates the send", () => {
    const matched = matchedQueueRowIds(
      [queueRow("a", "yes", "queued", TS)],
      [transcriptUser("yes", TS - 3_600_000)],
    );
    expect(matched.size).toBe(0);
  });
});

describe("retryQueuedMessage", () => {
  test("posts to the queue retry endpoint", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    await retryQueuedMessage("sess-1", "abc123", (path, init) => {
      calls.push({ path, init });
      return Promise.resolve({});
    });

    expect(calls).toEqual([
      { path: "/api/sessions/sess-1/queue/abc123/retry", init: { method: "POST" } },
    ]);
  });

  test("propagates a server refusal", async () => {
    await expect(
      retryQueuedMessage("sess-1", "abc123", () => Promise.reject(new Error("404 Not Found"))),
    ).rejects.toThrow("404 Not Found");
  });
});
