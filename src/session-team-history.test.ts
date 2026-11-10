// A parent keeps its finished children: the close path stamps the parent on
// the resume catalog, and the Team view walks live and closed children.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PATHS } from "./config.ts";
import { listEndedChildren, resetResumeCacheConnectionForTests, upsertResumableRows, type ResumableCacheRow } from "./resume-cache.ts";
import { endedTeam } from "./session-team-history.ts";
import { writePanelStatus } from "./session-panel.ts";

const home = mkdtempSync(join(tmpdir(), "omg-team-history-"));
const originalData = PATHS.data;
beforeAll(() => {
  PATHS.data = home;
  resetResumeCacheConnectionForTests();
});
afterAll(() => {
  resetResumeCacheConnectionForTests();
  PATHS.data = originalData;
  rmSync(home, { recursive: true, force: true });
});

const closed = (sessionId: string, parentSessionId: string | null, archivedAt: number | null, title = sessionId): ResumableCacheRow => ({
  sessionId,
  cwd: "/w",
  project: "",
  title,
  lastUserText: null,
  lastActivityAt: 1,
  agent: "codex",
  backend: "codex-aisdk",
  path: null,
  mtimeMs: 1,
  managed: true,
  archivedAt,
  parentSessionId,
});

test("the parent link survives a later scan, and only closed rows count", () => {
  upsertResumableRows([closed("c1", "lead", 10, "MOVER #1\nlong prompt")]);
  // The transcript scan knows nothing of the close or the parent.
  upsertResumableRows([{ ...closed("c1", null, null, "MOVER #1\nlong prompt") }]);
  upsertResumableRows([closed("never-closed", "lead", null)]);
  expect(listEndedChildren(["lead"]).map((r) => [r.sessionId, r.parentSessionId, r.archivedAt])).toEqual([["c1", "lead", 10]]);
});

test("walks through live and closed children; returns only the closed ones", async () => {
  upsertResumableRows([
    closed("g1", "live-child", 20),
    closed("g2", "c1-native", 30),
    closed("c1-native", "lead", 15),
    closed("resumed", "lead", 40),
  ]);
  await writePanelStatus("g1", { headline: "Moved 9 of 9 apps" });
  const live = [
    { sessionId: "lead", parentSessionId: null },
    { sessionId: "live-child", parentSessionId: "lead" },
    { sessionId: "resumed", parentSessionId: "lead" },
  ];
  const team = endedTeam(["lead"], live);
  const byId = Object.fromEntries(team.map((m) => [m.sessionId, m]));
  expect(Object.keys(byId).sort()).toEqual(["c1", "c1-native", "g1", "g2"]);
  expect(byId.c1).toMatchObject({ parentSessionId: "lead", title: "MOVER #1", agent: "codex-aisdk", endedAt: 10 });
  expect(byId.g1.parentSessionId).toBe("live-child");
  expect(byId.g1.plan?.headline).toBe("Moved 9 of 9 apps");
  expect(byId.g2.parentSessionId).toBe("c1-native");
});
