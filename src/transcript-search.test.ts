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
