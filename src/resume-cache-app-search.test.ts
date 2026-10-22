// Session search finds a session by the app its folder links to.
//
// From a session replay: a customer searched her sessions for her app's name,
// "questnest", saw "No sessions match", decided her work was lost, and built
// the same app a second time. The session's title named the idea, not the app.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  queryResumableCache,
  resetResumeCacheConnectionForTests,
  upsertResumableRows,
  type ResumableCacheRow,
} from "./resume-cache.ts";

const originalData = PATHS.data;
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lfg-app-search-"));
  PATHS.data = root;
  resetResumeCacheConnectionForTests();
});

afterEach(() => {
  resetResumeCacheConnectionForTests();
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

function row(sessionId: string, cwd: string, title: string): ResumableCacheRow {
  return {
    sessionId, cwd, project: "project", title, lastUserText: null, lastActivityAt: 1_000,
    agent: "claude", path: `/tmp/${sessionId}.jsonl`, mtimeMs: 1_000, resumable: true,
  };
}

test("a search for an app's name finds the sessions in its folder and subfolders, and only those", () => {
  upsertResumableRows([
    row("built", "/home/u/repos/project", "Build a house chores quest game"),
    row("nested", "/home/u/repos/project/web", "Fix the score"),
    row("sibling", "/home/u/repos/project-two", "Other work"),
    row("unrelated", "/home/u/repos/notes", "Notes"),
  ]);
  const appFolders = [{ cwd: "/home/u/repos/project", name: "questnest questnest-ab12c" }];
  const found = queryResumableCache({ limit: 10, search: "questnest", appFolders });
  expect(found.sessions.map((s) => s.sessionId).sort()).toEqual(["built", "nested"]);
  // Every term must still match: the app name and a word from the title.
  expect(queryResumableCache({ limit: 10, search: "questnest score", appFolders }).sessions.map((s) => s.sessionId)).toEqual(["nested"]);
  expect(queryResumableCache({ limit: 10, search: "questnest" }).total).toBe(0);
});
