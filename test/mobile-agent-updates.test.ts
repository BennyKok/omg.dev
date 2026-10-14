import { describe, expect, test } from "bun:test";
import { runAgentUpdateAll, type AgentUpdateRow } from "../mobile/src/omg/agent-updates";

type Agent = { key: string; label: string; status: Record<string, unknown> };

/** A Computer whose GET /api/coding-agents answers from a script, one poll at a time. */
function computer(started: { kinds: string[]; agents: Agent[] }, polls: Agent[][], log?: { error: string | null }) {
  const calls: string[] = [];
  let poll = 0;
  return {
    calls,
    transport: {
      async request<T>(path: string): Promise<T> {
        calls.push(path);
        if (path === "/api/coding-agents/update-all") return started as T;
        if (path === "/api/coding-agents/setup/log") return (log ?? { error: null }) as T;
        const agents = polls[Math.min(poll, polls.length - 1)]!;
        poll += 1;
        return { agents } as T;
      },
    },
  };
}

const sleep = async () => {};

describe("runAgentUpdateAll", () => {
  test("reports each agent's step, then a per-agent result", async () => {
    const box = computer(
      {
        kinds: ["codex", "opencode"],
        agents: [
          { key: "codex", label: "Codex", status: { version: "0.1.0", setupRunning: true } },
          { key: "opencode", label: "OpenCode", status: { version: "1.2.0", setupRunning: true } },
        ],
      },
      [
        [
          { key: "codex", label: "Codex", status: { setupRunning: true, setupProgress: { percent: 40, label: "Installing latest CLI…" } } },
          { key: "opencode", label: "OpenCode", status: { setupRunning: true, setupProgress: { percent: 5, label: "Waiting…" } } },
        ],
        [
          { key: "codex", label: "Codex", status: { version: "0.1.0", setupRunning: false, setupResult: { action: "update", ok: false, error: "network down", finishedAt: 1 } } },
          { key: "opencode", label: "OpenCode", status: { version: "1.3.0", setupRunning: false, setupResult: { action: "update", ok: true, finishedAt: 1 } } },
        ],
      ],
    );
    const seen: AgentUpdateRow[][] = [];
    const outcome = await runAgentUpdateAll(box.transport, { sleep, onProgress: (rows) => seen.push(rows) });
    expect(seen[1]![0]).toEqual({ key: "codex", label: "Codex", running: true, percent: 40, step: "Installing latest CLI…" });
    expect(outcome.ok).toBe(false);
    expect(outcome.title).toBe("1 of 2 agents failed to update");
    expect(outcome.rows).toEqual([
      { key: "codex", ok: false, line: "Codex update failed", error: "network down" },
      { key: "opencode", ok: true, line: "OpenCode updated from v1.2.0 to v1.3.0", error: undefined },
    ]);
    // A Computer that reports results is not asked for its log.
    expect(box.calls).not.toContain("/api/coding-agents/setup/log");
  });

  test("an older Computer without results still surfaces the log's failure", async () => {
    const box = computer(
      { kinds: ["codex"], agents: [{ key: "codex", label: "Codex", status: { setupRunning: true } }] },
      [[{ key: "codex", label: "Codex", status: { setupRunning: false } }]],
      { error: "npm ERR! network down\nmore" },
    );
    const outcome = await runAgentUpdateAll(box.transport, { sleep });
    expect(outcome).toMatchObject({ ok: false, title: "Update failed", description: "npm ERR! network down" });
  });

  test("a run past the time limit says it is still going", async () => {
    const box = computer(
      { kinds: ["codex"], agents: [{ key: "codex", label: "Codex", status: { setupRunning: true } }] },
      [[{ key: "codex", label: "Codex", status: { setupRunning: true } }]],
    );
    await expect(runAgentUpdateAll(box.transport, { sleep, timeoutMs: 0 })).rejects.toThrow("Still updating");
  });

  test("a Computer without the route asks for a software update", async () => {
    const transport = {
      async request<T>(): Promise<T> {
        throw Object.assign(new Error("not found"), { status: 404 });
      },
    };
    await expect(runAgentUpdateAll(transport, { sleep })).rejects.toThrow("needs a software update");
  });
});
