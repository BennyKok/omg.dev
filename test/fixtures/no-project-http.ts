// Separate process: provider stubs must never leak into the main test suite.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = await mkdtemp(join(tmpdir(), "omg-no-project-http-"));
process.env.OMG_DATA_DIR = join(root, "data");
const workspace = await import("../../src/no-project-chat");
const makeWorkspace = workspace.createNoProjectWorkspace;
mock.module("../../src/no-project-chat", () => ({
  ...workspace,
  createNoProjectWorkspace: (name: string) => makeWorkspace(name, join(root, "chats")),
}));
const provider = await import("../../src/coding-agent-provider");
const launches: any[] = [];
mock.module("../../src/coding-agent-provider", () => ({
  ...provider,
  launchCodingAgentSession: (options: unknown) => { launches.push(options); return { ok: true }; },
}));
const repos = await import("../../src/repo-list");
mock.module("../../src/repo-list", () => ({ ...repos, listConfiguredRepos: async () => [] }));
const { setGlobalSettings } = await import("../../src/settings");
await setGlobalSettings({ maxLiveAgents: 0, autoSessionTitles: "off" });
const { cmdServe } = await import("../../src/commands/serve");
let handler: any;
const originalServe = Bun.serve;
const captured = new Error("Captured HTTP handler before background services start");
Bun.serve = ((options: any) => { handler = options.fetch; throw captured; }) as typeof Bun.serve;
try { await cmdServe(); } catch (error) { if (error !== captured) throw error; }
Bun.serve = originalServe;
assert.equal(typeof handler, "function");
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
const post = (path: string, body: unknown, key?: string) => fetch(`${server.url}${path.slice(1)}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body),
});
try {
  const bad = await post("/api/sessions/new-unassigned", { cwd: "/some/repo", agent: "codex" });
  assert.equal(bad.status, 400);
  assert.equal(launches.length, 0);
  const normal = await post("/api/sessions/new", { prompt: "Hello", agent: "codex" });
  assert.equal(normal.status, 400, "normal launch still requires a configured repo");
  const response = await post("/api/sessions/new-unassigned", { prompt: "Help me create a website.", agent: "codex", title: "My website" }, "first");
  const result = await response.json() as any;
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.session.project, "");
  assert.equal(result.session.title, "My website");
  assert.equal(launches.length, 1);
  assert.equal(launches[0].prompt, "Help me create a website.");
  assert.ok(result.cwd.startsWith(join(root, "chats") + "/"));
  assert.match(await readFile(join(result.cwd, "AGENTS.md"), "utf8"), /answer ordinary questions directly/);
  const replay = await (await post("/api/sessions/new-unassigned", { prompt: "Help me create a website.", agent: "codex" }, "first")).json() as any;
  assert.equal(replay.sessionId, result.sessionId);
  assert.equal(launches.length, 1);
  const { listManaged, resetManagedRegistryForTests } = await import("../../src/managed");
  resetManagedRegistryForTests();
  const persisted = listManaged().find(row => row.sessionId === result.sessionId);
  assert.equal(persisted?.project, "");
  assert.equal(persisted?.cwd, result.cwd);
  console.log("PASS: real HTTP handler isolates no-project chats, preserves prompts, validates conflicts, and replays safely");
} finally {
  server.stop(true);
  await rm(root, { recursive: true, force: true });
}
process.exit(0);
