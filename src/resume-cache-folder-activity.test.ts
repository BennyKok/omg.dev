import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  lastActivityByProject,
  resetResumeCacheConnectionForTests,
  upsertResumableRows,
  type ResumableCacheRow,
} from "./resume-cache.ts";

const originalData = PATHS.data;
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lfg-folder-activity-"));
  PATHS.data = root;
  resetResumeCacheConnectionForTests();
});

afterEach(() => {
  resetResumeCacheConnectionForTests();
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

const row = (id: string, project: string, lastActivityAt: number, extra: { scheduled?: boolean } = {}): ResumableCacheRow => ({
  sessionId: `${id.repeat(8)}-${id.repeat(4)}-4${id.repeat(3)}-8${id.repeat(3)}-${id.repeat(12)}`,
  cwd: `/home/dev/repos/${project || "none"}`,
  project,
  title: id,
  lastActivityAt,
  lastUserText: null,
  agent: "claude" as const,
  path: `/x/${id}.jsonl`,
  mtimeMs: lastActivityAt,
  ...extra,
});

test("returns the newest chat per project, leaving out scheduled runs and chats with no project", () => {
  upsertResumableRows([
    row("a", "lfg", 1_000),
    row("b", "lfg", 5_000),
    row("c", "vibes", 2_000),
    // An auto agent waking a folder is not the person using it.
    row("d", "vibes", 9_000, { scheduled: true }),
    row("e", "", 7_000),
  ]);
  expect(lastActivityByProject()).toEqual({ lfg: 5_000, vibes: 2_000 });
});
