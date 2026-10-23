import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { PATHS } from "./config.ts";
import {
  deleteTranscriptIndexForPath,
  indexSessionMessagesDirect,
  indexTranscriptMessages,
  latestIndexedAssistantCursor,
  latestIndexedAssistantRowids,
  resetTranscriptIndexConnectionForTests,
  sessionIndexKey,
} from "./transcript-index.ts";

// /tmp is RAM on the dev box; keep scratch databases on disk.
const scratch = join(homedir(), ".cache", "lfg", "tmp");
const originalData = PATHS.data;
let root = "";

beforeEach(() => {
  mkdirSync(scratch, { recursive: true });
  root = mkdtempSync(join(scratch, "omg-index-unread-"));
  PATHS.data = root;
  resetTranscriptIndexConnectionForTests();
});

afterEach(() => {
  resetTranscriptIndexConnectionForTests();
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

const dbFile = () => join(root, "transcript-index.sqlite");

let seq = 0;
const msg = (role: string, kind: string, text: string) => ({
  id: `m-${++seq}`,
  role,
  kind: kind as "text",
  text,
  ts: Date.now(),
});

/** The pre-cache answer, computed straight from SQLite on its own connection. */
function truth(sessionIds: string[]): Map<string, number> {
  const raw = new Database(dbFile(), { readonly: true });
  try {
    const rows = raw
      .query<{ session_id: string; rowid: number }, string[]>(
        `SELECT session_id, MAX(rowid) AS rowid FROM transcript_messages
          WHERE session_id IN (${sessionIds.map(() => "?").join(",")})
            AND (role = 'assistant' OR (role = 'user' AND text LIKE '[Peer message from %'))
          GROUP BY session_id`,
      )
      .all(...sessionIds);
    return new Map(rows.map((row) => [row.session_id, row.rowid]));
  } finally {
    raw.close();
  }
}

describe("unread cursors on the session roster", () => {
  test("follow new activity after the first read without rescanning", () => {
    const ids = ["s-a", "s-b", "s-c"];
    indexSessionMessagesDirect("s-a", [msg("assistant", "text", "hello")]);
    indexSessionMessagesDirect("s-b", [msg("user", "text", "mine")]);
    expect(latestIndexedAssistantRowids(ids)).toEqual(truth(ids));

    // A tool result is user-role but not activity; a peer envelope is.
    indexSessionMessagesDirect("s-b", [msg("user", "tool_result", "x".repeat(20_000))]);
    expect(latestIndexedAssistantRowids(ids).has("s-b")).toBe(false);
    indexSessionMessagesDirect("s-b", [msg("user", "text", "[Peer message from bot (b1) to me (m1)] hi")]);
    indexSessionMessagesDirect("s-c", [msg("assistant", "tool_use", "Bash")]);
    indexSessionMessagesDirect("s-a", [msg("assistant", "text", "again")]);

    const after = latestIndexedAssistantRowids(ids);
    expect(after).toEqual(truth(ids));
    expect(after.size).toBe(3);
  });

  test("see rows another process commits", () => {
    const ids = ["s-out"];
    indexSessionMessagesDirect("s-out", [msg("assistant", "text", "one")]);
    const before = latestIndexedAssistantRowids(ids).get("s-out");
    expect(before).toBeGreaterThan(0);

    // A managed harness is a separate process with its own connection.
    const other = new Database(dbFile());
    other.exec("PRAGMA busy_timeout = 5000");
    other
      .query(
        `INSERT INTO transcript_messages (id, session_id, path, message_id, byte_offset, order_seq, ts, role, kind, text)
         VALUES ('ext-1', 's-out', ?, 'ext-1', 99, 99, 0, 'assistant', 'text', 'from a harness')`,
      )
      .run(sessionIndexKey("s-out"));
    other.close();

    const after = latestIndexedAssistantRowids(ids).get("s-out");
    expect(after).toBeGreaterThan(before!);
    expect(new Map([["s-out", after!]])).toEqual(truth(ids));
    expect(latestIndexedAssistantCursor("s-out")?.messageId).toBe("ext-1");
  });

  test("drop back when the newest activity is deleted", async () => {
    // File-backed session: two transcript files under one session id.
    const first = join(root, "first.jsonl");
    const path = join(root, "rollout.jsonl");
    writeFileSync(first, "");
    writeFileSync(path, "");
    indexTranscriptMessages(first, "s-del", [{ offset: 0, messages: [msg("assistant", "text", "kept")] }]);
    const kept = latestIndexedAssistantRowids(["s-del"]).get("s-del")!;
    indexTranscriptMessages(path, "s-del", [{ offset: 0, messages: [msg("assistant", "text", "file row")] }]);
    expect(latestIndexedAssistantRowids(["s-del"]).get("s-del")).toBeGreaterThan(kept);

    deleteTranscriptIndexForPath(path);
    expect(latestIndexedAssistantRowids(["s-del"]).get("s-del")).toBe(kept);
  });

  test("do not leak between databases", () => {
    indexSessionMessagesDirect("s-same", [msg("assistant", "text", "first db")]);
    expect(latestIndexedAssistantRowids(["s-same"]).has("s-same")).toBe(true);
    const second = mkdtempSync(join(scratch, "omg-index-unread-"));
    try {
      PATHS.data = second;
      expect(latestIndexedAssistantRowids(["s-same"]).has("s-same")).toBe(false);
    } finally {
      PATHS.data = root;
      rmSync(second, { recursive: true, force: true });
    }
  });
});
