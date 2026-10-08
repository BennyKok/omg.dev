/** @jsxImportSource ../../web/node_modules/react */
import { mount, type Mounted } from "../../web/src/test-support/render";
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as React from "../../web/node_modules/react";
import { resolve } from "node:path";
mock.module(resolve(import.meta.dir, "../node_modules/react/index.js"), () => React);
mock.module("expo-router", () => ({ useFocusEffect: (callback: () => unknown) => React.useEffect(callback as () => any, [callback]) }));
let readsFail = false;
let write: () => Promise<unknown>;
const finding = { id: "f/1", agentId: "watch", title: "Disk pressure" };
const requests: string[] = [];
const client = { transport: { request: async (path: string, init?: RequestInit) => {
  requests.push(path);
  if (init?.method === "POST") return write();
  if (path === "/api/auto/agents") return { agents: [] };
  if (readsFail) throw new Error("offline");
  return { findings: [finding] };
} } };
mock.module(resolve(import.meta.dir, "../src/omg/provider.tsx"), () => ({ useOmg: () => ({ client, bindingId: "test" }) }));
const { useAutoAgents, selectHomeAutoFindings, groupHomeAutoFindings, sortFindingRows } = await import("../src/omg/auto-agents");
let state: ReturnType<typeof useAutoAgents>;
function Probe() { state = useAutoAgents(); return <div>{state.findings.map((f) => f.title).join()} {state.findingsError}</div>; }
let ui: Mounted;
beforeEach(() => { readsFail = false; requests.length = 0; write = async () => ({}); ui = mount(); });
afterEach(() => ui.cleanup());
async function render() { await ui.flushAsync(async () => ui.render(<Probe />)); }

test("a pending status change keeps the finding visible until confirmed", async () => {
  let finish!: (value: unknown) => void;
  write = () => new Promise((resolve) => { finish = resolve; });
  await render();
  let pending!: Promise<void>;
  await ui.flushAsync(async () => { pending = state.setFindingStatus("f/1", "dismissed"); });
  expect(state.findings).toHaveLength(1);
  expect(requests).toContain("/api/auto/findings/f%2F1");
  await ui.flushAsync(async () => { finish({}); await pending; });
  expect(state.findings).toHaveLength(0);
});
test("a failed status request rejects and retains the finding", async () => {
  write = async () => { throw new Error("write failed"); };
  await render();
  await ui.flushAsync(async () => {
    await expect(state.setFindingStatus("f/1", "dismissed")).rejects.toThrow("write failed");
  });
  expect(state.findings).toHaveLength(1);
});
test("load errors remain distinct from an empty list and retry clears the error", async () => {
  readsFail = true; await render();
  expect(state.loading).toBe(false);
  expect(state.findingsError).toContain("Could not load findings");
  readsFail = false;
  await ui.flushAsync(async () => state.refresh());
  expect(state.findingsError).toBeNull(); expect(state.findings).toHaveLength(1);
});

test("Updates and reports put the latest occurrence first regardless of severity", () => {
  const findings = [
    { id: "old-urgent", agentId: "bugs", title: "Old", severity: "high" as const, createdAt: 100 },
    { id: "earlier-pr", agentId: "prs", title: "Earlier", severity: "high" as const, createdAt: 200 },
    { id: "repeated-pr", agentId: "prs", title: "Repeated", severity: "low" as const, createdAt: 50, lastSeenAt: 400 },
    { id: "recent-bug", agentId: "bugs", title: "Recent", severity: "low" as const, createdAt: 300 },
    { id: "undated", agentId: "gone", title: "Undated" },
  ];
  const original = findings.map(f => f.id);
  const rows = selectHomeAutoFindings([], findings);
  expect(rows.map(row => row.finding.id)).toEqual(["repeated-pr", "recent-bug", "earlier-pr", "old-urgent", "undated"]);
  const groups = groupHomeAutoFindings(rows);
  expect(groups.map(group => group.agentId)).toEqual(["prs", "bugs", "gone"]);
  expect(groups[0]!.rows.map(row => row.finding.id)).toEqual(["repeated-pr", "earlier-pr"]);
  expect(sortFindingRows(findings.filter(f => f.agentId === "bugs")).map(f => f.id)).toEqual(["recent-bug", "old-urgent"]);
  expect(findings.map(f => f.id)).toEqual(original);
});
