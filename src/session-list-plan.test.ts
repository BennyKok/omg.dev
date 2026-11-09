// The session list carries each session's plan in brief, so a parent's Team
// view can show what every child is doing (web/src/lib/session-team.ts).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PATHS } from "./config.ts";
import { writeSessionPlan } from "./session-plan.ts";
import { sessionListRow } from "./commands/serve.ts";
import type { Session } from "./sessions.ts";

const home = mkdtempSync(join(tmpdir(), "omg-list-plan-"));
const originalData = PATHS.data;
beforeAll(() => {
  PATHS.data = home;
});
afterAll(() => {
  PATHS.data = originalData;
  rmSync(home, { recursive: true, force: true });
});

const row = (sessionId: string) => ({ sessionId, cmd: "lfg aisdk-session --secret-prompt", title: "t" }) as unknown as Session;

test("a row has its plan summary, and still no command line", () => {
  writeSessionPlan("child-1", {
    source: "codex",
    updatedAt: 1,
    items: [
      { id: "1", text: "Copy the data", status: "completed" },
      { id: "2", text: "Switch the link", status: "in_progress" },
    ],
    agents: [{ id: "a", title: "Check parity", status: "running", startedAt: 1, detail: "Using Bash" }],
  });
  const out = sessionListRow(row("child-1")) as Record<string, unknown>;
  expect(out.cmd).toBeUndefined();
  expect(out.plan).toEqual({
    done: 1,
    total: 2,
    current: "Switch the link",
    running: [{ title: "Check parity", detail: "Using Bash" }],
    finished: 0,
  });
});

test("a session with no plan has no plan field", () => {
  const out = sessionListRow(row("no-plan")) as Record<string, unknown>;
  expect("plan" in out).toBe(false);
});
