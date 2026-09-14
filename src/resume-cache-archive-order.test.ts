// The archive picker's default page: no scheduled runs, newest archive first.
//
// Both surfaces (the web Resume sheet and the iOS Archive screen) read the same
// /api/sessions/resumable endpoint, so this query is the only place either
// behavior lives. Tests drive queryResumableCache directly rather than asserting
// on the two clients' source.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  queryResumableCache,
  resetResumeCacheConnectionForTests,
  upsertResumableRows,
  type ResumableCacheRow,
} from "./resume-cache.ts";
import { WATCH_AGENT_OPENING, isScheduledRunPrompt } from "./auto/watch-agent-signature.ts";

const originalData = PATHS.data;
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lfg-archive-order-"));
  PATHS.data = root;
  resetResumeCacheConnectionForTests();
});

afterEach(() => {
  resetResumeCacheConnectionForTests();
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

function row(over: Partial<ResumableCacheRow> & { sessionId: string }): ResumableCacheRow {
  return {
    cwd: "/home/dev/repos/lfg",
    project: "lfg",
    title: "a session",
    lastUserText: null,
    lastActivityAt: 1_000,
    agent: "claude",
    path: `/tmp/${over.sessionId}.jsonl`,
    mtimeMs: 1_000,
    resumable: true,
    ...over,
  };
}

describe("scheduled runs are hidden by default", () => {
  test("the default page excludes them and includeScheduled brings them back", () => {
    upsertResumableRows([
      row({ sessionId: "human", title: "fix the onboarding flow" }),
      row({ sessionId: "watch", title: `${WATCH_AGENT_OPENING} Carry out…`, scheduled: true }),
    ]);

    const shown = queryResumableCache({ limit: 10 });
    expect(shown.total).toBe(1);
    expect(shown.sessions.map((s) => s.sessionId)).toEqual(["human"]);

    const all = queryResumableCache({ limit: 10, includeScheduled: true });
    expect(all.total).toBe(2);
    expect(all.sessions.map((s) => s.sessionId).sort()).toEqual(["human", "watch"]);
  });

  test("facet counts drop the hidden rows too, so no chip overcounts its page", () => {
    upsertResumableRows([
      row({ sessionId: "human", agent: "claude" }),
      row({ sessionId: "watch-a", agent: "claude", scheduled: true }),
      row({ sessionId: "watch-b", agent: "claude", scheduled: true }),
    ]);

    expect(queryResumableCache({ limit: 10 }).facets.agents).toEqual([
      { agent: "claude", count: 1 },
    ]);
    expect(queryResumableCache({ limit: 10, includeScheduled: true }).facets.agents).toEqual([
      { agent: "claude", count: 3 },
    ]);
  });

  test("a later scan cannot clear the flag on a schedule-spawned session", () => {
    // The close path marks a spawnedBy="schedule" session from the managed
    // registry. removeManaged then drops that registry row, so the next file
    // scan re-enriches the same session_id knowing only the transcript, whose
    // prompt carries no signature. The flag has to survive that.
    upsertResumableRows([row({ sessionId: "sched", title: "nightly deploy check", scheduled: true })]);
    upsertResumableRows([row({ sessionId: "sched", title: "nightly deploy check", mtimeMs: 2_000 })]);

    expect(queryResumableCache({ limit: 10 }).total).toBe(0);
    expect(queryResumableCache({ limit: 10, includeScheduled: true }).total).toBe(1);
  });

  test("the signature matches the runner's prompt on every backend", () => {
    // auto/runner.ts builds ONE prompt and sends it to whichever backend the
    // auto agent selected, so this opening is the marker for all of them.
    expect(isScheduledRunPrompt(`${WATCH_AGENT_OPENING} Carry out the instruction below.`)).toBe(
      true,
    );
    expect(isScheduledRunPrompt("You are an autonomous agent I hired")).toBe(false);
    expect(isScheduledRunPrompt(null)).toBe(false);
  });
});

describe("ordering is by archive time", () => {
  test("a session archived now outranks one whose last turn is newer", () => {
    // The exact case the old ORDER BY got wrong: a long-idle session that the
    // human archives today. Its final turn is ancient, so last_activity_at
    // buried it on the page it should have topped.
    upsertResumableRows([
      row({ sessionId: "recent-turn", lastActivityAt: 9_000, mtimeMs: 9_000 }),
      row({ sessionId: "just-archived", lastActivityAt: 10, mtimeMs: 10, archivedAt: 50_000 }),
    ]);

    expect(queryResumableCache({ limit: 10 }).sessions.map((s) => s.sessionId)).toEqual([
      "just-archived",
      "recent-turn",
    ]);
  });

  test("rows with no archive time fall back to last activity", () => {
    // Every row that predates the column, plus anything the box never saw
    // close (a reboot, a crash). They must keep their old relative order.
    upsertResumableRows([
      row({ sessionId: "older", lastActivityAt: 1_000, mtimeMs: 1_000 }),
      row({ sessionId: "newer", lastActivityAt: 3_000, mtimeMs: 3_000 }),
      row({ sessionId: "middle", lastActivityAt: 2_000, mtimeMs: 2_000 }),
    ]);

    const page = queryResumableCache({ limit: 10 });
    expect(page.sessions.map((s) => s.sessionId)).toEqual(["newer", "middle", "older"]);
    expect(page.sessions.map((s) => s.archivedAt)).toEqual([null, null, null]);
  });

  test("a background scan refresh does not erase a recorded archive time", () => {
    // The scan reads transcripts; it cannot see a close event, so it always
    // passes archivedAt undefined. Without the COALESCE in the upsert, the
    // next refresh would silently reset every archived session to its last
    // turn and undo the ordering above.
    upsertResumableRows([
      row({ sessionId: "closed", lastActivityAt: 10, mtimeMs: 10, archivedAt: 50_000 }),
    ]);
    upsertResumableRows([row({ sessionId: "closed", lastActivityAt: 10, mtimeMs: 11 })]);

    expect(queryResumableCache({ limit: 10 }).sessions[0]?.archivedAt).toBe(50_000);
  });

  test("closing a session again moves it back to the top", () => {
    upsertResumableRows([
      row({ sessionId: "a", lastActivityAt: 10, mtimeMs: 10, archivedAt: 100 }),
      row({ sessionId: "b", lastActivityAt: 20, mtimeMs: 20, archivedAt: 200 }),
    ]);
    expect(queryResumableCache({ limit: 10 }).sessions[0]?.sessionId).toBe("b");

    // Resumed, worked in, closed again — the close path re-stamps the row.
    upsertResumableRows([
      row({ sessionId: "a", lastActivityAt: 30, mtimeMs: 30, archivedAt: 300 }),
    ]);
    expect(queryResumableCache({ limit: 10 }).sessions[0]?.sessionId).toBe("a");
  });
});

describe("migration 008 backfills existing rows", () => {
  test("marks the watch-agent rows already in the cache without a rescan", () => {
    // 4,904 of the 14,648 rows on this box were watch-agent runs when this
    // shipped. Forcing a re-enrichment pass (the mtime_ms = -1 trick migrations
    // 005 and 006 use) would have re-read every one of those transcripts. The
    // preamble is already stored verbatim at the head of title / last_user_text,
    // so SQL can see it and the upgrade stays free.
    const db = new Database(join(root, "cache.sqlite"), { create: true });
    db.exec(`
      CREATE TABLE resumable_sessions (
        session_id TEXT PRIMARY KEY,
        cwd TEXT,
        project TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        last_user_text TEXT,
        last_activity_at INTEGER,
        agent TEXT NOT NULL DEFAULT 'claude',
        path TEXT,
        mtime_ms REAL NOT NULL DEFAULT 0
      );
    `);
    for (const name of [
      "001_managed_session_resume",
      "002_historical_sessions",
      "003_native_tui_resume",
      "004_repair_backend_identity",
      "005_refresh_historical_titles",
      "006_strip_runtime_contract_titles",
      "007_fast_mode",
    ]) {
      db.exec(
        readFileSync(new URL(`./migrations/resume-cache/${name}.sql`, import.meta.url), "utf8"),
      );
    }
    expect(
      db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version,
    ).toBe(7);

    db.query(
      "INSERT INTO resumable_sessions (session_id, title, last_user_text, mtime_ms) VALUES (?, ?, ?, ?)",
    ).run("titled", `${WATCH_AGENT_OPENING} Carry out the instruction below.`, null, 42);
    db.query(
      "INSERT INTO resumable_sessions (session_id, title, last_user_text, mtime_ms) VALUES (?, ?, ?, ?)",
    ).run("preview", "lfg", `${WATCH_AGENT_OPENING} Go`, 42);
    db.query(
      "INSERT INTO resumable_sessions (session_id, title, last_user_text, mtime_ms) VALUES (?, ?, ?, ?)",
    ).run("human", "ship the widget", "ship the widget", 42);

    db.exec(
      readFileSync(
        new URL("./migrations/resume-cache/008_archive_scheduled_runs.sql", import.meta.url),
        "utf8",
      ),
    );

    const columns = db
      .query<{ name: string }, []>("PRAGMA table_info(resumable_sessions)")
      .all()
      .map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(["scheduled", "archived_at"]));

    expect(
      db
        .query<{ session_id: string }, []>(
          "SELECT session_id FROM resumable_sessions WHERE scheduled = 1 ORDER BY session_id",
        )
        .all()
        .map((r) => r.session_id),
    ).toEqual(["preview", "titled"]);

    // No re-enrichment: the backfill must not touch the fingerprint, or every
    // upgraded box rescans its whole transcript history.
    expect(
      db.query<{ mtime_ms: number }, []>("SELECT mtime_ms FROM resumable_sessions WHERE session_id = 'titled'").get()
        ?.mtime_ms,
    ).toBe(42);
    // Nothing can be back-dated, so archive times start empty and the ordering
    // falls back to last activity for every pre-existing row.
    expect(
      db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM resumable_sessions WHERE archived_at IS NOT NULL").get()
        ?.n,
    ).toBe(0);
    expect(
      db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version,
    ).toBe(8);
    db.close();
  });
});
