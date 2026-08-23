// Search used to run through an fts5 mirror of every indexed message. The
// mirror was dropped (migration 12) because every read here is scoped to a
// single session and sessions are small, so the mirror only added a second
// write-amplified insert to the ingest path that ~16 agent processes contend
// on. These tests pin the behaviour the mirror used to provide: all terms must
// match, matching is case-insensitive, results stay scoped to one session, and
// LIKE wildcards typed by the user are literals rather than operators.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  indexSessionMessagesDirect,
  resetTranscriptIndexConnectionForTests,
  searchTranscriptIndex,
  sessionIndexKey,
  TRANSCRIPT_SEARCH_MAX_LIMIT,
} from "./transcript-index.ts";
import type { SessionMsg } from "./sessions.ts";

const SESSION = "55555555-5555-4555-8555-555555555555";
const OTHER = "66666666-6666-4666-8666-666666666666";

function msg(id: string, text: string): SessionMsg {
  return { id, role: "assistant", kind: "text", text, ts: Date.now() } as SessionMsg;
}

async function search(session: string, query: string) {
  const res = await searchTranscriptIndex(sessionIndexKey(session), session, query);
  return res.results.map((r) => r.snippet);
}

describe("transcript search without the fts mirror", () => {
  const originalData = PATHS.data;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-transcript-search-"));
    PATHS.data = join(root, "data");
    resetTranscriptIndexConnectionForTests();
  });

  afterEach(() => {
    resetTranscriptIndexConnectionForTests();
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  test("requires every term, not any of them", async () => {
    indexSessionMessagesDirect(SESSION, [
      msg("a", "the deploy pipeline failed"),
      msg("b", "the deploy succeeded"),
      msg("c", "an unrelated pipeline note"),
    ]);
    const hits = await search(SESSION, "deploy pipeline");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("the deploy pipeline failed");
  });

  test("matches case-insensitively", async () => {
    indexSessionMessagesDirect(SESSION, [
      msg("a", "Database Is Locked"),
    ]);
    expect(await search(SESSION, "database is locked")).toHaveLength(1);
    expect(await search(SESSION, "DATABASE")).toHaveLength(1);
  });

  test("stays scoped to the requested session", async () => {
    indexSessionMessagesDirect(SESSION, [msg("a", "shared token")]);
    indexSessionMessagesDirect(OTHER, [msg("b", "shared token")]);
    expect(await search(SESSION, "shared token")).toHaveLength(1);
    expect(await search(OTHER, "shared token")).toHaveLength(1);
  });

  test("treats % and _ as literals, not wildcards", async () => {
    indexSessionMessagesDirect(SESSION, [
      msg("a", "cpu hit 100% during the build"),
      msg("b", "cpu was fine"),
    ]);
    // A bare `%` would match every row if it reached LIKE unescaped.
    const pct = await search(SESSION, "100%");
    expect(pct).toHaveLength(1);
    expect(pct[0]).toContain("100%");

    indexSessionMessagesDirect(SESSION, [
      msg("c", "the a_b marker"),
      msg("d", "the axb marker"),
    ]);
    const underscore = await search(SESSION, "a_b");
    expect(underscore).toHaveLength(1);
    expect(underscore[0]).toContain("a_b");
  });

  test("an empty or whitespace query returns nothing", async () => {
    indexSessionMessagesDirect(SESSION, [msg("a", "anything")]);
    expect(await search(SESSION, "")).toEqual([]);
    expect(await search(SESSION, "   ")).toEqual([]);
  });
});

// The transcript find bar is the second reader of this search, and it needs
// two things the voice agent never did: which message a hit is in, so it can
// map the hit to a virtualized row, and how many matches there really are, so
// it can say "3 of 137" rather than "3 of 3".
describe("search results carry what a find bar needs", () => {
  const originalData = PATHS.data;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lfg-transcript-find-"));
    PATHS.data = join(root, "data");
    resetTranscriptIndexConnectionForTests();
  });

  afterEach(() => {
    resetTranscriptIndexConnectionForTests();
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  test("every hit names its message, using the same id the transcript page renders", async () => {
    // rowMessage resolves a client message id as `message_id || id`, so this
    // is the only field that joins a hit to a rendered row. `offset` is
    // order_seq and never reaches a client.
    indexSessionMessagesDirect(SESSION, [
      msg("first", "the deploy pipeline failed"),
      msg("second", "unrelated"),
      msg("third", "the deploy pipeline recovered"),
    ]);
    const res = await searchTranscriptIndex(sessionIndexKey(SESSION), SESSION, "deploy pipeline");
    expect(res.results.map((r) => r.messageId).sort()).toEqual(["first", "third"]);
  });

  test("matchTotal counts every match, not just the page that came back", async () => {
    indexSessionMessagesDirect(
      SESSION,
      Array.from({ length: 9 }, (_, i) => msg(`m${i}`, `token number ${i}`)),
    );
    const clipped = await searchTranscriptIndex(
      sessionIndexKey(SESSION),
      SESSION,
      "token",
      { limit: 4 },
    );
    expect(clipped.results).toHaveLength(4);
    expect(clipped.total).toBe(4);
    expect(clipped.matchTotal).toBe(9);
    // `truncated` used to be hardcoded false, which was never true for a
    // clipped read. Without it the bar cannot tell the reader it is only
    // showing the most recent matches.
    expect(clipped.truncated).toBe(true);
  });

  test("an unclipped read reports itself as complete", async () => {
    indexSessionMessagesDirect(SESSION, [msg("a", "token one"), msg("b", "token two")]);
    const res = await searchTranscriptIndex(sessionIndexKey(SESSION), SESSION, "token", {
      limit: 10,
    });
    expect(res.total).toBe(2);
    expect(res.matchTotal).toBe(2);
    expect(res.truncated).toBe(false);
  });

  test("the clip keeps the most recent matches, in ascending order", async () => {
    // The reader is at the tail, so the useful window is the newest matches,
    // and the find bar walks them from the newest backwards.
    indexSessionMessagesDirect(
      SESSION,
      Array.from({ length: 5 }, (_, i) => ({
        id: `m${i}`,
        role: "assistant",
        kind: "text",
        text: `token ${i}`,
        ts: 1000 + i,
      })) as SessionMsg[],
    );
    const res = await searchTranscriptIndex(sessionIndexKey(SESSION), SESSION, "token", {
      limit: 2,
    });
    expect(res.results.map((r) => r.messageId)).toEqual(["m3", "m4"]);
  });

  test("the limit ceiling is wide enough for a find bar to walk", async () => {
    // 50 was enough for a voice agent quoting a line or two. A find bar
    // stepping through a common word in a long session would have most of its
    // matches silently withheld at that cap.
    expect(TRANSCRIPT_SEARCH_MAX_LIMIT).toBeGreaterThanOrEqual(200);
    indexSessionMessagesDirect(
      SESSION,
      Array.from({ length: 60 }, (_, i) => msg(`m${i}`, `token ${i}`)),
    );
    const res = await searchTranscriptIndex(sessionIndexKey(SESSION), SESSION, "token", {
      limit: 60,
    });
    expect(res.results).toHaveLength(60);
    expect(res.truncated).toBe(false);
  });

  test("an empty query reports zero matches rather than omitting the count", async () => {
    indexSessionMessagesDirect(SESSION, [msg("a", "anything")]);
    const res = await searchTranscriptIndex(sessionIndexKey(SESSION), SESSION, "  ");
    expect(res.matchTotal).toBe(0);
    expect(res.truncated).toBe(false);
  });
});
