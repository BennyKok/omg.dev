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
  holdMessage,
  jcodeAcceptedStatus,
  listHeld,
  listQueue,
  releaseNextHeldMessage,
  removeHeldMessage,
  setHeldBusyProbeForTests,
  setHeldReleaseHandler,
  updateHeldMessage,
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

describe("held messages", () => {
  afterEach(() => {
    setHeldReleaseHandler(null);
    setHeldBusyProbeForTests(async () => null);
  });

  test("a held row stays in the queue and survives a restart", () => {
    const sessionId = crypto.randomUUID();
    setHeldBusyProbeForTests(async () => true);
    const held = holdMessage(sessionId, "later please");
    expect(held.status).toBe("held");
    expect(listHeld(sessionId).map((m) => m.id)).toEqual([held.id]);
    resetSendQueueForTests();
    expect(getMessage(sessionId, held.id)?.status).toBe("held");
  });

  test("a held row can be edited and removed, a queued row cannot", () => {
    const sessionId = crypto.randomUUID();
    setHeldBusyProbeForTests(async () => true);
    const held = holdMessage(sessionId, "draft one");
    const queued = recordCommandFileMessage(sessionId, "already sent", true);
    expect((updateHeldMessage(sessionId, held.id, "draft two") as QueuedMsg).text).toBe("draft two");
    expect(updateHeldMessage(sessionId, queued.id, "nope")).toBe("not-held");
    expect(updateHeldMessage(sessionId, "missing", "nope")).toBeNull();
    expect(removeHeldMessage(sessionId, queued.id)).toBe("not-held");
    expect(removeHeldMessage(sessionId, held.id)).toBe(true);
    expect(removeHeldMessage(sessionId, held.id)).toBe(false);
    resetSendQueueForTests();
    expect(getMessage(sessionId, held.id)).toBeNull();
  });

  test("clearing resolved rows keeps a held row", () => {
    const sessionId = crypto.randomUUID();
    setHeldBusyProbeForTests(async () => true);
    const held = holdMessage(sessionId, "keep me");
    recordCommandFileMessage(sessionId, "resolved", true);
    expect(clearResolved(sessionId)).toBe(1);
    expect(listQueue(sessionId).map((m) => m.id)).toEqual([held.id]);
  });

  test("releases every held row in order once the session is idle", async () => {
    const sessionId = crypto.randomUUID();
    let busy = true;
    setHeldBusyProbeForTests(async () => busy);
    const released: string[] = [];
    setHeldReleaseHandler(async (_sid, text) => {
      released.push(text);
      return { ok: true };
    });
    holdMessage(sessionId, "first");
    holdMessage(sessionId, "second");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(released).toEqual([]);
    busy = false;
    await waitFor(() => released.length === 2, 5_000);
    expect(released).toEqual(["first", "second"]);
    expect(listQueue(sessionId)).toEqual([]);
  });

  // The bug these cover, from the 2026-09-12 trace: seven held rows left one
  // session inside 40 ms, the first started a turn and the other six went into
  // the harness's private queue, where the composer queue bar could not show
  // them and the user could not edit them. The last one reached the agent 26
  // minutes later.
  test("releases one held row per idle tick while a released row is still in flight", async () => {
    const sessionId = crypto.randomUUID();
    // Stale busy, the real failure mode: the session list keeps answering
    // "idle" for seconds after a send, so every tick in that window sees the
    // same `false` the tick that released the first row saw.
    setHeldBusyProbeForTests(async () => false);
    const released: string[] = [];
    setHeldReleaseHandler(async (sid, text) => {
      released.push(text);
      // What serve.ts does: the send path records its own queue row. Nothing
      // reconciles it here, so it stays in flight.
      recordCommandFileMessage(sid, text, true);
      return { ok: true };
    });
    holdMessage(sessionId, "first");
    holdMessage(sessionId, "second");
    holdMessage(sessionId, "third");

    await waitFor(() => released.length === 1, 5_000);
    // Several more ticks with the same stale idle reading.
    await new Promise((resolve) => setTimeout(resolve, 3_500));

    expect(released).toEqual(["first"]);
    expect(listHeld(sessionId).map((m) => m.text)).toEqual(["second", "third"]);
    // The two that stayed behind are still editable and still removable.
    expect(updateHeldMessage(sessionId, listHeld(sessionId)[1]!.id, "third, edited")).toMatchObject({
      status: "held",
    });
    expect(removeHeldMessage(sessionId, listHeld(sessionId)[1]!.id)).toBe(true);
  }, 20_000);

  test("releases the next held row once the one before it reaches the transcript", async () => {
    const sessionId = crypto.randomUUID();
    setHeldBusyProbeForTests(async () => false);
    const released: string[] = [];
    setHeldReleaseHandler(async (sid, text) => {
      released.push(text);
      recordCommandFileMessage(sid, text, true);
      return { ok: true };
    });
    holdMessage(sessionId, "first");
    holdMessage(sessionId, "second");

    await waitFor(() => released.length === 1, 5_000);
    expect(listHeld(sessionId).map((m) => m.text)).toEqual(["second"]);
    // The agent read it: its user turn is now in the transcript, which is what
    // retires the queue row. The watcher runs reconcileQueued itself, so this
    // needs no connected client.
    indexSessionMessagesDirect(sessionId, [
      { id: "user-1", role: "user", kind: "text", text: "first", ts: Date.now() },
    ]);

    await waitFor(() => released.length === 2, 8_000);
    expect(released).toEqual(["first", "second"]);
    expect(listHeld(sessionId)).toEqual([]);
  }, 20_000);

  // The narrower race inside the same bug: the gate can clear fast. The
  // harness marks itself busy and THEN writes the user row, so a reconcile a
  // second after the release can retire the queue row while the session list
  // is still serving the snapshot it took before the release. A release
  // decided on that snapshot lands on top of a running turn.
  test("does not release the next row on a stale idle reading after a fast reconcile", async () => {
    const sessionId = crypto.randomUUID();
    let reallyBusy = false;
    // The cached reading is stuck on "idle" for the whole test. Only a fresh
    // one tells the truth.
    setHeldBusyProbeForTests(async (_sid, opts) => (opts.fresh ? reallyBusy : false));
    const released: string[] = [];
    setHeldReleaseHandler(async (sid, text) => {
      released.push(text);
      recordCommandFileMessage(sid, text, true);
      // The harness takes it: busy first, then the user row lands, so the
      // next tick's reconcileQueued retires the row it just created.
      reallyBusy = true;
      indexSessionMessagesDirect(sid, [
        { id: `user-${released.length}`, role: "user", kind: "text", text, ts: Date.now() },
      ]);
      return { ok: true };
    });
    holdMessage(sessionId, "first");
    holdMessage(sessionId, "second");

    await waitFor(() => released.length === 1, 5_000);
    await new Promise((resolve) => setTimeout(resolve, 3_500));

    // The in-flight gate opened as soon as "first" was indexed, and the cached
    // reading still says idle. Only the fresh reading keeps "second" back.
    expect(listQueue(sessionId).find((m) => m.text === "first")?.status).toBe("delivered");
    expect(released).toEqual(["first"]);
    expect(listHeld(sessionId).map((m) => m.text)).toEqual(["second"]);

    reallyBusy = false;
    await waitFor(() => released.length === 2, 8_000);
    expect(released).toEqual(["first", "second"]);
  }, 20_000);

  // Every step of a tick awaits, and the fresh busy probe forces a full
  // session scan. When those outlast the 1s poll the intervals overlap, and
  // two ticks that each read idle would each take listHeld()[0] — the same
  // row, twice, because a row is only removed once its handler resolves.
  test("a slow probe and a slow handler still release one row once", async () => {
    const sessionId = crypto.randomUUID();
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    setHeldBusyProbeForTests(async () => {
      await sleep(1_200); // Longer than HELD_POLL_MS: ticks now overlap.
      return false;
    });
    const released: string[] = [];
    let inHandler = 0;
    let overlapped = false;
    setHeldReleaseHandler(async (sid, text) => {
      if (++inHandler > 1) overlapped = true;
      await sleep(1_200);
      released.push(text);
      recordCommandFileMessage(sid, text, true);
      inHandler--;
      return { ok: true };
    });
    const first = holdMessage(sessionId, "only once");
    holdMessage(sessionId, "and not this one yet");

    await waitFor(() => released.length >= 1, 10_000);
    await sleep(3_000);

    expect(overlapped).toBe(false);
    expect(released).toEqual(["only once"]);
    expect(getMessage(sessionId, first.id)).toBeNull();
    expect(listHeld(sessionId).map((m) => m.text)).toEqual(["and not this one yet"]);
  }, 30_000);

  test("a queued row that outlived a restart holds the released rows back", async () => {
    const sessionId = crypto.randomUUID();
    setHeldBusyProbeForTests(async () => false);
    // A queue-mode send accepted before the restart, still waiting on the
    // agent, plus two held rows. All three are in SQLite.
    recordCommandFileMessage(sessionId, "sent before the restart", true);
    holdMessage(sessionId, "held one");
    holdMessage(sessionId, "held two");
    // Restart: drop every timer and in-memory queue, reload from the store.
    resetSendQueueForTests();
    const released: string[] = [];
    setHeldBusyProbeForTests(async () => false);
    setHeldReleaseHandler(async (sid, text) => {
      released.push(text);
      recordCommandFileMessage(sid, text, true);
      return { ok: true };
    });

    resumePersistedQueues();
    await new Promise((resolve) => setTimeout(resolve, 3_500));

    // The older queued row is ahead in line, so nothing is released on top of
    // it, and both held rows are still on the queue bar.
    expect(released).toEqual([]);
    expect(listHeld(sessionId).map((m) => m.text)).toEqual(["held one", "held two"]);
    expect(listQueue(sessionId).filter((m) => m.status === "queued")).toHaveLength(1);
  }, 20_000);

  test("a failed release does not hold the rest of the queue back", async () => {
    const sessionId = crypto.randomUUID();
    setHeldBusyProbeForTests(async () => false);
    // Nothing is in flight after a refusal: the text never left, so the row is
    // terminal and visible with its reason. The next row is free to try.
    setHeldReleaseHandler(async () => ({ ok: false, error: "no pane" }));
    const first = holdMessage(sessionId, "unlucky one");
    const second = holdMessage(sessionId, "unlucky two");

    await waitFor(
      () =>
        getMessage(sessionId, first.id)?.status === "failed" &&
        getMessage(sessionId, second.id)?.status === "failed",
      8_000,
    );
    expect(getMessage(sessionId, first.id)?.error).toBe("no pane");
    expect(getMessage(sessionId, second.id)?.error).toBe("no pane");
  }, 20_000);

  test("a refused release stays visible as failed with the reason", async () => {
    const sessionId = crypto.randomUUID();
    setHeldBusyProbeForTests(async () => true);
    setHeldReleaseHandler(async () => ({ ok: false, error: "no pane" }));
    const held = holdMessage(sessionId, "unlucky");
    expect(await releaseNextHeldMessage(sessionId)).toBe(0);
    expect(getMessage(sessionId, held.id)?.status).toBe("failed");
    expect(getMessage(sessionId, held.id)?.error).toBe("no pane");
  });

  test("an older table without the held status is rebuilt with its rows intact", () => {
    resetSendQueueForTests();
    const legacy = new Database(join(testDataPath, "lfg.sqlite"), { create: true });
    legacy.exec(`
      CREATE TABLE send_queue_messages (
        session_id TEXT NOT NULL,
        id TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'sending', 'delivered', 'queued', 'failed')),
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        queued_behind_turn INTEGER NOT NULL DEFAULT 0 CHECK(queued_behind_turn IN (0, 1)),
        PRIMARY KEY (session_id, id)
      );
    `);
    const sessionId = crypto.randomUUID();
    legacy
      .query("INSERT INTO send_queue_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(sessionId, "old-1", "old row", "queued", null, 0, 1, 1, 1);
    legacy.close();
    setHeldBusyProbeForTests(async () => true);
    const held = holdMessage(sessionId, "new row");
    expect(listQueue(sessionId).map((m) => [m.id, m.status])).toEqual([
      ["old-1", "queued"],
      [held.id, "held"],
    ]);
  });
});
