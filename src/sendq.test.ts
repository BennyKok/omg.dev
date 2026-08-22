import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "bun:sqlite";
import { PATHS } from "./config.ts";
import {
  clearResolved,
  getMessage,
  jcodeAcceptedStatus,
  listQueue,
  reconcileQueued,
  recordCommandFileMessage,
  resetSendQueueForTests,
  resumePersistedQueues,
  retryMessage,
  takeUndeliveredQueue,
  type QueuedMsg,
} from "./sendq.ts";
import { writeStoredQueueMessage } from "./sendq-store.ts";
import {
  indexSessionMessagesDirect,
  resetTranscriptIndexConnectionForTests,
} from "./transcript-index.ts";
import type { SessionMsg } from "./sessions.ts";

const originalDataPath = PATHS.data;
let testDataPath = "";

async function waitFor(cond: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function runQueueProcess(source: string, ...args: string[]): string {
  const configUrl = pathToFileURL(join(import.meta.dir, "config.ts")).href;
  const queueUrl = pathToFileURL(join(import.meta.dir, "sendq.ts")).href;
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "-e",
      `const { PATHS } = await import(${JSON.stringify(configUrl)});\n` +
        "PATHS.data = process.argv[1];\n" +
        `const queue = await import(${JSON.stringify(queueUrl)});\n` +
        source,
      testDataPath,
      ...args,
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = result.stderr.toString();
  expect(result.exitCode, stderr).toBe(0);
  return result.stdout.toString().trim();
}

beforeEach(() => {
  testDataPath = mkdtempSync(join(tmpdir(), "lfg-sendq-"));
  PATHS.data = testDataPath;
  resetSendQueueForTests();
  resetTranscriptIndexConnectionForTests();
});

afterEach(() => {
  resetSendQueueForTests();
  resetTranscriptIndexConnectionForTests();
  PATHS.data = originalDataPath;
  rmSync(testDataPath, { recursive: true, force: true });
});

describe("Jcode send queue status", () => {
  test("keeps a line queued while Jcode is on an earlier turn", () => {
    expect(jcodeAcceptedStatus(true)).toBe("queued");
  });

  test("settles a line that Jcode accepted while idle", () => {
    expect(jcodeAcceptedStatus(false)).toBe("delivered");
  });
});

describe("command-file queue state", () => {
  test("keeps an SDK message hydratable until transcript reconciliation", () => {
    const id = crypto.randomUUID();
    const message = recordCommandFileMessage(id, "follow up", true);
    expect(message.status).toBe("queued");
    expect(message.queuedBehindTurn).toBe(true);
    expect(listQueue(id)).toEqual([message]);
  });

  test("stores queue rows in the shared SQLite database", () => {
    const databasePath = join(testDataPath, "lfg.sqlite");
    const existing = new Database(databasePath, { create: true });
    existing.exec("CREATE TABLE sentinel (value TEXT NOT NULL); INSERT INTO sentinel VALUES ('kept')");
    existing.close();

    const sessionId = crypto.randomUUID();
    const message = recordCommandFileMessage(sessionId, "persist me", false);
    resetSendQueueForTests();

    const stored = new Database(databasePath, { readonly: true });
    const queueRow = stored
      .query<{ text: string; status: string }, [string, string]>(
        "SELECT text, status FROM send_queue_messages WHERE session_id = ? AND id = ?",
      )
      .get(sessionId, message.id);
    const sentinel = stored.query<{ value: string }, []>("SELECT value FROM sentinel").get();
    stored.close();

    expect(queueRow).toEqual({ text: "persist me", status: "queued" });
    expect(sentinel).toEqual({ value: "kept" });
  });

  test("hydrates queue rows after a process restart", () => {
    const sessionId = crypto.randomUUID();
    const message = recordCommandFileMessage(sessionId, "survive restart", true);

    resetSendQueueForTests();

    expect(listQueue(sessionId)).toEqual([message]);
  });

  test("survives a real process boundary", () => {
    const sessionId = crypto.randomUUID();
    const written = JSON.parse(
      runQueueProcess(
        "console.log(JSON.stringify(queue.recordCommandFileMessage(process.argv[2], 'cross-process', true)));",
        sessionId,
      ),
    );

    const hydrated = JSON.parse(
      runQueueProcess(
        "console.log(JSON.stringify(queue.listQueue(process.argv[2])));",
        sessionId,
      ),
    );

    expect(hydrated).toEqual([written]);
  });

  test("keeps cleared queue rows removed after a process restart", () => {
    const sessionId = crypto.randomUUID();
    recordCommandFileMessage(sessionId, "remove me", false);
    expect(clearResolved(sessionId)).toBe(1);

    resetSendQueueForTests();

    expect(listQueue(sessionId)).toEqual([]);
  });

  test("marks interrupted sends as failed during server restart recovery", () => {
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    writeStoredQueueMessage(sessionId, {
      id: "interrupted-message",
      text: "possibly submitted",
      status: "sending",
      attempts: 1,
      createdAt: now,
      updatedAt: now,
    });
    resetSendQueueForTests();

    expect(resumePersistedQueues()).toBe(0);
    expect(listQueue(sessionId)).toEqual([
      expect.objectContaining({
        id: "interrupted-message",
        status: "failed",
        error: expect.stringContaining("server restart"),
      }),
    ]);
  });

  test("hands undelivered rows to a replacement session and keeps the rest", () => {
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    for (const [index, status] of (["delivered", "sending", "failed"] as const).entries()) {
      writeStoredQueueMessage(sessionId, {
        id: `${status}-row`,
        text: status,
        status,
        attempts: 1,
        createdAt: now + index,
        updatedAt: now + index,
      });
    }
    resetSendQueueForTests();
    const first = recordCommandFileMessage(sessionId, "routine one", true);
    const second = recordCommandFileMessage(sessionId, "routine two", true);

    // Only rows that never reached the agent move, and they keep their order.
    const carried = takeUndeliveredQueue(sessionId);
    expect(carried.map((m) => m.id)).toEqual([first.id, second.id]);
    // A `sending` row still belongs to its delivery worker, and terminal rows
    // stay as the history of the retired session.
    expect(listQueue(sessionId).map((m) => m.status).sort())
      .toEqual(["delivered", "failed", "sending"]);

    // Removed from the store too: a carried message must not be live in the
    // old queue and the new one at the same time.
    resetSendQueueForTests();
    expect(listQueue(sessionId).some((m) => m.id === first.id || m.id === second.id)).toBe(false);
  });

  test("takes nothing from a queue with no undelivered rows", () => {
    const sessionId = crypto.randomUUID();
    expect(takeUndeliveredQueue(sessionId)).toEqual([]);
  });

  test("prunes delivered rows in memory and in SQLite", () => {
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    for (let index = 0; index < 14; index++) {
      writeStoredQueueMessage(sessionId, {
        id: `delivered-${index}`,
        text: `message ${index}`,
        status: "delivered",
        attempts: 1,
        createdAt: now + index,
        updatedAt: now + index,
      });
    }
    recordCommandFileMessage(sessionId, "still waiting", true);

    // The 14 delivered rows prune to the newest 12; the unreconciled queued
    // row is not retention-bounded and survives.
    const rows = listQueue(sessionId);
    expect(rows).toHaveLength(13);
    expect(rows.filter((m) => m.status === "delivered")).toHaveLength(12);
    expect(rows.filter((m) => m.status === "queued")).toHaveLength(1);
    expect(rows.some((m) => m.id === "delivered-0" || m.id === "delivered-1")).toBe(false);

    resetSendQueueForTests();

    expect(listQueue(sessionId)).toHaveLength(13);
  });

  test("keeps more than 12 unreconciled queued rows", () => {
    const sessionId = crypto.randomUUID();
    for (let index = 0; index < 14; index++) {
      recordCommandFileMessage(sessionId, `message ${index}`, true);
    }
    expect(listQueue(sessionId)).toHaveLength(14);

    resetSendQueueForTests();

    expect(listQueue(sessionId)).toHaveLength(14);
  });

  test("keeps failed rows across a restart so the UI can retry them", () => {
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    writeStoredQueueMessage(sessionId, {
      id: "failed-1",
      text: "did not land",
      status: "failed",
      error: "message never left the input box after retries",
      attempts: 3,
      createdAt: now,
      updatedAt: now,
    });
    // Enqueue past the old terminal cap: failed rows must not prune away.
    for (let index = 0; index < 13; index++) {
      recordCommandFileMessage(sessionId, `later ${index}`, true);
    }

    resetSendQueueForTests();

    const failed = listQueue(sessionId).find((m) => m.id === "failed-1");
    expect(failed).toEqual(
      expect.objectContaining({
        status: "failed",
        error: "message never left the input box after retries",
      }),
    );
    expect(listQueue(sessionId)).toHaveLength(14);
  });
});

describe("reconcileQueued", () => {
  function userRow(text: string, ts: number, id: string): SessionMsg {
    return { id, role: "user", kind: "text", text, ts };
  }

  function toolRows(count: number, startTs: number): SessionMsg[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `tool-${i}`,
      role: "assistant",
      kind: "tool_use" as const,
      text: `Bash: run step ${i}`,
      ts: startTs + i,
    }));
  }

  test("promotes a queued row buried behind a long tool-heavy turn", async () => {
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    // The user row lands, then the turn it starts buries it under hundreds of
    // tool rows before the next reconcile tick — far past a 40-row window.
    indexSessionMessagesDirect(sessionId, [
      userRow("ship the release", now, "user-1"),
      ...toolRows(450, now + 1),
    ]);
    const message = recordCommandFileMessage(sessionId, "ship the release", true);

    const changed = await reconcileQueued(sessionId);

    expect(changed).toBe(true);
    expect(getMessage(sessionId, message.id)?.status).toBe("delivered");
    resetSendQueueForTests();
    expect(getMessage(sessionId, message.id)?.status).toBe("delivered");
  });

  test("leaves a queued row whose text only appears before it was sent", async () => {
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    // An identical message from an hour ago is not this send's row.
    indexSessionMessagesDirect(sessionId, [userRow("yes", now - 3_600_000, "user-old")]);
    const message = recordCommandFileMessage(sessionId, "yes", true);

    const changed = await reconcileQueued(sessionId);

    expect(changed).toBe(false);
    expect(getMessage(sessionId, message.id)?.status).toBe("queued");
  });

  test("matches repeated identical messages one-to-one", async () => {
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const first = recordCommandFileMessage(sessionId, "looks good", true);
    const second = recordCommandFileMessage(sessionId, "looks good", true);
    // Only the first follow-up has been read so far.
    indexSessionMessagesDirect(sessionId, [userRow("looks good", now, "user-1")]);

    await reconcileQueued(sessionId);

    expect(getMessage(sessionId, first.id)?.status).toBe("delivered");
    expect(getMessage(sessionId, second.id)?.status).toBe("queued");

    // A later reconcile tick must not let the second queue row reuse the
    // transcript row that the delivered first queue row already claimed.
    expect(await reconcileQueued(sessionId)).toBe(false);
    expect(getMessage(sessionId, second.id)?.status).toBe("queued");

    // The second row lands on a later tick; now both reconcile.
    indexSessionMessagesDirect(sessionId, [userRow("looks good", now + 1_000, "user-2")]);

    await reconcileQueued(sessionId);

    expect(getMessage(sessionId, second.id)?.status).toBe("delivered");
  });
});

describe("retryMessage", () => {
  function failedRow(sessionId: string): QueuedMsg {
    const now = Date.now();
    const row: QueuedMsg = {
      id: "failed-1",
      text: "retry me",
      status: "failed",
      error: "message never left the input box after retries",
      attempts: 3,
      createdAt: now,
      updatedAt: now,
    };
    writeStoredQueueMessage(sessionId, row);
    resetSendQueueForTests();
    return row;
  }

  test("returns null for an unknown id", () => {
    expect(retryMessage(crypto.randomUUID(), "nope")).toBeNull();
  });

  test("leaves a non-failed row untouched", () => {
    const sessionId = crypto.randomUUID();
    const queued = recordCommandFileMessage(sessionId, "waiting", true);
    expect(retryMessage(sessionId, queued.id)).toEqual(queued);
  });

  test("re-queues a failed row and the worker re-attempts delivery", async () => {
    const sessionId = crypto.randomUUID();
    failedRow(sessionId);

    const retried = retryMessage(sessionId, "failed-1");

    // Re-queued with the failure cleared; the delivery worker may already have
    // claimed the row (pending → sending) by the time the call returns.
    expect(retried).not.toBeNull();
    expect(["pending", "sending"]).toContain(retried!.status);
    expect(retried!.error).toBeUndefined();
    expect(retried!.attempts).toBe(0);
    // The delivery worker picks the row up on its own; with no tmux pane
    // behind this session the retry lands back in failed with a fresh error.
    await waitFor(() => getMessage(sessionId, "failed-1")?.status === "failed");
    expect(getMessage(sessionId, "failed-1")?.error).toBeTruthy();
  });
});
