import { describe, expect, test } from "bun:test";
import { buildTeam, flattenTeam, teamActivity, teamTitle, type TeamSessionRow } from "./session-team";

const row = (id: string, parent: string | null, extra: Partial<TeamSessionRow> = {}): TeamSessionRow => ({
  sessionId: id,
  parentSessionId: parent,
  agent: "aisdk",
  title: id,
  startedAt: 1,
  ...extra,
});

describe("buildTeam", () => {
  test("nests children and grandchildren under the session, in start order", () => {
    const rows = [
      row("lead", null),
      row("b", "lead", { startedAt: 3, busy: true, agent: "codex-aisdk" }),
      row("a", "lead", { startedAt: 2 }),
      row("b1", "b", { status: "blocked", statusDetail: "Out of credits" }),
      row("other", null),
      row("x", "other"),
    ];
    const team = buildTeam(rows, "lead");
    expect(team.map((m) => m.id)).toEqual(["a", "b"]);
    expect(team[1]).toMatchObject({ agent: "Codex", state: "working" });
    expect(team[1].children.map((m) => m.id)).toEqual(["b1"]);
    expect(team[1].children[0]).toMatchObject({ state: "blocked", activity: "Out of credits" });
    expect(flattenTeam(team).map((m) => m.id)).toEqual(["a", "b", "b1"]);
    expect(buildTeam(rows, "a")).toEqual([]);
  });

  test("finds children that point at the native id, and survives a cycle", () => {
    const rows = [
      row("lead", null, { nativeSessionId: "native-lead" }),
      { ...row("c", null), parentNativeSessionId: "native-lead", nativeSessionId: "native-c" },
      row("loop1", "loop2"),
      row("loop2", "loop1"),
    ];
    expect(buildTeam(rows, "lead").map((m) => [m.id, m.nativeId])).toEqual([["c", "native-c"]]);
    const loop = buildTeam(rows, "loop1");
    expect(flattenTeam(loop).map((m) => m.id)).toEqual(["loop2"]);
  });

  test("carries the child's plan summary", () => {
    const plan = { done: 1, total: 4, current: "Copy", running: [{ title: "Check", detail: "Using Bash" }], finished: 0 };
    expect(buildTeam([row("lead", null), row("c", "lead", { plan })], "lead")[0].plan).toEqual(plan);
  });
});

describe("what a member shows", () => {
  test("the first line of a long or broken title", () => {
    expect(teamTitle(row("x", null, { title: "undefined\nGROUP B: move the games\nmore" }))).toBe("GROUP B: move the games");
    expect(teamTitle(row("x", null, { title: null, lastUserText: null }))).toBe("Untitled session");
  });

  test("its last message, report or tool as one plain line", () => {
    const last = (l: TeamSessionRow["last"]) => teamActivity(row("x", null, { last: l }));
    expect(last({ role: "assistant", kind: "text", text: "**Done.** Moved 6 apps.\nDetails…" })).toBe("Done. Moved 6 apps.");
    expect(last({ role: "user", kind: "text", text: "[Background task Mover · 1e7178c3]\n\n[subagent progress] Copy at 40%" })).toBe(
      "Message: Copy at 40%",
    );
    expect(last({ role: "assistant", kind: "tool_use", text: "Bash: {\n \"command\": \"ls\"}" })).toBe("Running a command");
    expect(last({ role: "assistant", kind: "tool_use", text: "$ /bin/bash -lc 'ls'" })).toBe("Running a command");
    expect(last({ role: "assistant", kind: "tool_use", text: "mcp__omg__omg_send_session_message: {}" })).toBe("Using omg_send_session_message");
    expect(last({ role: "assistant", kind: "thinking", text: "(thinking)" })).toBe("Thinking");
    expect(last(undefined)).toBe("");
  });
});
