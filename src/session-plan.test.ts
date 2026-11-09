import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PATHS } from "./config.ts";
import { normalizePlan, PlanTracker, readSessionPlan, summarizeSessionPlan, writeSessionPlan, type SessionPlan } from "./session-plan.ts";

const originalData = PATHS.data;
const root = mkdtempSync(join(tmpdir(), "session-plan-"));
afterAll(() => {
  (PATHS as { data: string }).data = originalData;
  rmSync(root, { recursive: true, force: true });
});

function tracker(source = "claude") {
  const writes: SessionPlan[] = [];
  let t = 1000;
  const tr = new PlanTracker("sid-1", source, (_id, plan) => writes.push(structuredClone(plan)), () => (t += 1), null);
  return { tr, writes, last: () => writes.at(-1)! };
}

const assistant = (blocks: unknown[], parent: string | null = null) => ({
  type: "assistant",
  parent_tool_use_id: parent,
  message: { content: blocks },
});
const user = (blocks: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "user",
  parent_tool_use_id: null,
  message: { content: blocks },
  ...extra,
});

describe("Claude", () => {
  test("TodoWrite replaces the list each time", () => {
    const { tr, writes, last } = tracker();
    tr.claudeMessage(assistant([{ type: "tool_use", id: "t1", name: "TodoWrite", input: { todos: [
      { content: "Read the code", status: "completed", activeForm: "Reading the code" },
      { content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
      { content: "Ship", status: "pending", activeForm: "Shipping" },
    ] } }]));
    expect(last().items.map((i) => [i.text, i.status])).toEqual([
      ["Read the code", "completed"],
      ["Write tests", "in_progress"],
      ["Ship", "pending"],
    ]);
    expect(last().items[1].activeText).toBe("Writing tests");
    tr.claudeMessage(assistant([{ type: "tool_use", id: "t2", name: "TodoWrite", input: { todos: [
      { content: "Ship", status: "in_progress", activeForm: "Shipping" },
    ] } }]));
    expect(last().items.map((i) => i.text)).toEqual(["Ship"]);
    expect(writes.length).toBe(2);
  });

  test("a sub-agent's own TodoWrite does not touch the session's plan", () => {
    const { tr, writes } = tracker();
    tr.claudeMessage(assistant([{ type: "tool_use", id: "t1", name: "TodoWrite", input: { todos: [
      { content: "Inner step", status: "pending", activeForm: "x" },
    ] } }], "toolu_parent"));
    expect(writes.length).toBe(0);
  });

  test("TaskCreate shows at once, takes its real id from the result, then TaskUpdate moves it", () => {
    const { tr, last } = tracker();
    tr.claudeMessage(assistant([{ type: "tool_use", id: "tc1", name: "TaskCreate", input: { subject: "Fix the bug", description: "d", activeForm: "Fixing the bug" } }]));
    expect(last().items).toEqual([{ id: "pending:tc1", text: "Fix the bug", status: "pending", activeText: "Fixing the bug" }]);
    tr.claudeMessage(user([{ type: "tool_result", tool_use_id: "tc1", content: "Task #7 created successfully: Fix the bug" }]));
    expect(last().items[0].id).toBe("7");
    tr.claudeMessage(assistant([{ type: "tool_use", id: "tu1", name: "TaskUpdate", input: { taskId: "7", status: "in_progress" } }]));
    expect(last().items[0].status).toBe("in_progress");
    tr.claudeMessage(assistant([{ type: "tool_use", id: "tu2", name: "TaskUpdate", input: { taskId: "7", status: "deleted" } }]));
    expect(last().items).toEqual([]);
  });

  test("the structured TaskCreate result wins over the text", () => {
    const { tr, last } = tracker();
    tr.claudeMessage(assistant([{ type: "tool_use", id: "tc1", name: "TaskCreate", input: { subject: "A", description: "d" } }]));
    tr.claudeMessage(user([{ type: "tool_result", tool_use_id: "tc1", content: "ok" }], { tool_use_result: { task: { id: "42", subject: "A" } } }));
    expect(last().items[0].id).toBe("42");
  });

  test("a failed TaskCreate is removed", () => {
    const { tr, last } = tracker();
    tr.claudeMessage(assistant([{ type: "tool_use", id: "tc1", name: "TaskCreate", input: { subject: "A", description: "d" } }]));
    tr.claudeMessage(user([{ type: "tool_result", tool_use_id: "tc1", is_error: true, content: "no" }]));
    expect(last().items).toEqual([]);
  });

  test("a foreground Agent call runs until its result", () => {
    const { tr, last } = tracker();
    tr.claudeMessage(assistant([{ type: "tool_use", id: "ag1", name: "Agent", input: { description: "Search the repo", prompt: "p", subagent_type: "Explore" } }]));
    expect(last().agents).toMatchObject([{ id: "ag1", title: "Search the repo", kind: "Explore", status: "running" }]);
    tr.claudeMessage(user([{ type: "tool_result", tool_use_id: "ag1", content: "found it" }]));
    expect(last().agents[0].status).toBe("completed");
    expect(last().agents[0].endedAt).toBeGreaterThan(0);
  });

  test("a background agent stays running past its immediate result and ends with its notification", () => {
    const { tr, last } = tracker();
    tr.claudeMessage(assistant([{ type: "tool_use", id: "ag1", name: "Agent", input: { description: "Review", prompt: "p" } }]));
    tr.claudeMessage({ type: "system", subtype: "task_started", task_id: "task-a", tool_use_id: "ag1", description: "Review", subagent_type: "general-purpose" });
    tr.claudeMessage(user([{ type: "tool_result", tool_use_id: "ag1", content: "Async agent launched successfully." }]));
    expect(last().agents[0].status).toBe("running");
    // The progress description is the current activity; the name stays.
    tr.claudeMessage({ type: "system", subtype: "task_progress", task_id: "task-a", tool_use_id: "ag1", description: "Reading src/app.ts", last_tool_name: "Read", usage: {} });
    expect(last().agents[0]).toMatchObject({ title: "Review", detail: "Reading src/app.ts" });
    tr.claudeMessage({ type: "system", subtype: "task_progress", task_id: "task-a", tool_use_id: "ag1", last_tool_name: "Grep", usage: {} });
    expect(last().agents[0].detail).toBe("Using Grep");
    tr.claudeMessage({ type: "system", subtype: "task_notification", task_id: "task-a", tool_use_id: "ag1", status: "completed", summary: "Two findings", output_file: "" });
    expect(last().agents).toHaveLength(1);
    expect(last().agents[0]).toMatchObject({ status: "completed", detail: "Two findings" });
  });

  test("a background shell task shows as its own row and can be killed", () => {
    const { tr, last } = tracker();
    tr.claudeMessage({ type: "system", subtype: "task_started", task_id: "b1", description: "npm run dev", task_type: "local_bash" });
    expect(last().agents[0]).toMatchObject({ id: "b1", title: "npm run dev", kind: "local_bash", status: "running" });
    tr.claudeMessage({ type: "system", subtype: "task_updated", task_id: "b1", patch: { status: "killed", end_time: 5000 } });
    expect(last().agents[0]).toMatchObject({ status: "stopped", endedAt: 5000 });
  });

  test("housekeeping tasks the SDK hides stay hidden", () => {
    const { tr, writes } = tracker();
    tr.claudeMessage({ type: "system", subtype: "task_started", task_id: "h", description: "memory", skip_transcript: true });
    expect(writes.length).toBe(0);
  });

  test("nothing is written when nothing changed, and junk never throws", () => {
    const { tr, writes } = tracker();
    tr.claudeMessage({ type: "assistant", message: { content: "text" } });
    tr.claudeMessage({ type: "assistant", message: { content: [null, 1, { type: "tool_use", name: "TodoWrite", input: { todos: "no" } }] } });
    tr.claudeMessage({ type: "system", subtype: "task_progress", task_id: "unknown" });
    expect(writes.length).toBe(0);
  });
});

describe("Codex", () => {
  const todo = (type: string, items: Array<[string, boolean]>) => ({
    type,
    item: { id: "item_3", type: "todo_list", items: items.map(([text, completed]) => ({ text, completed })) },
  });

  test("the first open step is the current one while the turn runs", () => {
    const { tr, last } = tracker("codex");
    tr.codexEvent(todo("item.started", [["Plan", false], ["Build", false]]));
    expect(last().items.map((i) => i.status)).toEqual(["in_progress", "pending"]);
    tr.codexEvent(todo("item.updated", [["Plan", true], ["Build", false]]));
    expect(last().items.map((i) => i.status)).toEqual(["completed", "in_progress"]);
    expect(last().source).toBe("codex");
  });

  test("when the turn ends the list stays, with no current step", () => {
    const { tr, last } = tracker("codex");
    tr.codexEvent(todo("item.updated", [["Plan", true], ["Build", false]]));
    tr.codexEvent(todo("item.completed", [["Plan", true], ["Build", false]]));
    expect(last().items.map((i) => i.status)).toEqual(["completed", "pending"]);
  });

  test("other items are ignored", () => {
    const { tr, writes } = tracker("codex");
    tr.codexEvent({ type: "item.completed", item: { type: "agent_message", text: "hi" } });
    expect(writes.length).toBe(0);
  });
});

describe("store", () => {
  beforeEach(() => {
    (PATHS as { data: string }).data = mkdtempSync(join(root, "data-"));
  });

  test("write then read round-trips, and a rewrite is seen", () => {
    const plan: SessionPlan = { source: "claude", updatedAt: 1, items: [{ id: "1", text: "A", status: "pending" }], agents: [] };
    writeSessionPlan("abc", plan);
    expect(readSessionPlan("abc")).toEqual(plan);
    writeSessionPlan("abc", { ...plan, items: [{ id: "1", text: "A", status: "completed" }] });
    expect(readSessionPlan("abc")?.items[0].status).toBe("completed");
  });

  test("ids that are not file names are refused", () => {
    writeSessionPlan("../escape", { source: "x", updatedAt: 1, items: [{ id: "1", text: "A", status: "pending" }], agents: [] });
    expect(readSessionPlan("../escape")).toBeNull();
    expect(readSessionPlan("")).toBeNull();
  });

  test("a corrupt or hostile file reads as a bounded plan or null", () => {
    mkdirSync(join(PATHS.data, "session-plans"), { recursive: true });
    writeFileSync(join(PATHS.data, "session-plans", "bad.json"), "{not json");
    expect(readSessionPlan("bad")).toBeNull();
    const huge = { source: "x", items: Array.from({ length: 500 }, (_, i) => ({ id: i, text: "y".repeat(5000), status: "pending" })), agents: [{ id: "a", status: "evil" }] };
    const plan = normalizePlan(huge)!;
    expect(plan.items.length).toBe(100);
    expect(plan.items[0].text.length).toBeLessThanOrEqual(500);
    expect(plan.agents).toEqual([]);
  });

  test("a tracker resumes from the plan on disk", () => {
    writeSessionPlan("resume", { source: "claude", updatedAt: 1, items: [{ id: "3", text: "Keep", status: "pending" }], agents: [] });
    const writes: SessionPlan[] = [];
    const tr = new PlanTracker("resume", "claude", (_id, p) => writes.push(structuredClone(p)));
    tr.claudeMessage(assistant([{ type: "tool_use", id: "u", name: "TaskUpdate", input: { taskId: "3", status: "completed" } }]));
    expect(writes.at(-1)!.items[0]).toMatchObject({ id: "3", status: "completed" });
  });
});

describe("summary for the session list", () => {
  test("progress, the current step, and the running sub-agents newest first", () => {
    const plan: SessionPlan = {
      source: "claude",
      updatedAt: 1,
      items: [
        { id: "1", text: "Read", status: "completed" },
        { id: "2", text: "Write the tests", activeText: "Writing the tests", status: "in_progress" },
        { id: "3", text: "Ship", status: "pending" },
      ],
      agents: [
        { id: "a", title: "Old", status: "completed", startedAt: 1 },
        ...Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, title: `Run ${i}`, kind: "Explore", detail: "x".repeat(400), status: "running" as const, startedAt: 2 + i })),
      ],
    };
    const s = summarizeSessionPlan(plan)!;
    expect(s).toMatchObject({ done: 1, total: 3, current: "Writing the tests", finished: 1 });
    expect(s.running.map((a) => a.title)).toEqual(["Run 6", "Run 5", "Run 4", "Run 3", "Run 2"]);
    expect(s.running[0].detail!.length).toBeLessThanOrEqual(120);
    expect(summarizeSessionPlan(null)).toBeNull();
    expect(summarizeSessionPlan({ source: "x", updatedAt: 1, items: [], agents: [] })).toBeNull();
  });
});
