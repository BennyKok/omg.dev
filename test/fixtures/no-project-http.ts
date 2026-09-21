// Separate process: provider stubs must never leak into the main test suite.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = await mkdtemp(join(tmpdir(), "omg-no-project-http-"));
process.env.OMG_DATA_DIR = join(root, "data");
process.env.LFG_REPOS_ROOT = join(root, "projects");
process.env.LFG_WORKTREE_ROOT = join(root, "worktrees");
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
const listConfiguredRepos = repos.listConfiguredRepos;
let showProjects = false;
mock.module("../../src/repo-list", () => ({ ...repos, listConfiguredRepos: (options: any) => showProjects ? listConfiguredRepos(options) : Promise.resolve([]) }));

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
  showProjects = true;
  process.env.LFG_BASE = String(server.url);
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { buildOmgMcpServer } = await import("../../src/commands/mcp");
  const mcp = buildOmgMcpServer();
  const client = new Client({ name: "project-flow-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const created = await client.callTool({ name: "omg_create_project", arguments: { name: "demo-site" } });
    assert.ok(!created.isError, JSON.stringify(created));
    const body = JSON.parse((created.content as any[])[0].text);
    assert.equal(body.repo.cwd, join(root, "projects", "demo-site"));
    assert.ok(body.repos.some((repo: any) => repo.cwd === body.repo.cwd));
    assert.equal(await readFile(join(body.repo.cwd, "README.md"), "utf8"), "# demo-site\n");
    const duplicate = await client.callTool({ name: "omg_create_project", arguments: { name: "demo-site" } });
    assert.equal(duplicate.isError, true);
    const badName = await post("/api/projects/create-folder", { name: "../escape" });
    assert.equal(badName.status, 400);
    const badParent = await post("/api/projects/create-folder", { name: "site", parent: 42 });
    assert.equal(badParent.status, 400);
    resetManagedRegistryForTests();
    assert.equal(listManaged().find(row => row.sessionId === result.sessionId)?.cwd, result.cwd);
    assert.equal(listManaged().find(row => row.sessionId === result.sessionId)?.project, "");
    // Use the real deploy owner with a fake control plane. No paid deployment.
    const { createCloudAppsClient } = await import("../../packages/cloud/src/apps");
    const { deployFolder, loadProjectLink } = await import("../../src/cloud-apps");
    await Bun.write(join(body.repo.cwd, "index.html"), "<h1>Demo site</h1>");
    const uploads: any[] = [];
    const cloud = createCloudAppsClient({
      getAuthToken: async () => "fixture-token",
      endpoints: { controlPlaneOrigin: "https://fixture.invalid" },
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes("/deploy-source")) {
          uploads.push(JSON.parse(String(init?.body)));
          return Response.json({ slug: "demo-site", projectId: "project-fixture", runId: "run-fixture", url: "https://demo-site.example", status: "accepted" });
        }
        if (url.includes("/apps/status")) return Response.json({ slug: "demo-site", phase: "ready", url: "https://demo-site.example", status: "ready" });
        throw new Error(`Unexpected fixture request: ${url}`);
      },
    });
    const deployed = await deployFolder(cloud, { cwd: body.repo.cwd, name: "Demo site", wait: true });
    assert.equal(deployed.latest?.phase, "ready");
    assert.equal(deployed.url, "https://demo-site.example");
    assert.equal(loadProjectLink(body.repo.cwd)?.projectId, "project-fixture");
    assert.equal(loadProjectLink(result.cwd), null);
    assert.ok(uploads[0].files.some((file: any) => file.path.endsWith("/index.html")));
    assert.ok(!uploads[0].files.some((file: any) => file.path.endsWith("/AGENTS.md")));
    assert.ok(!uploads[0].files.some((file: any) => file.path.endsWith("/CLAUDE.md")));
    assert.ok(!uploads[0].files.some((file: any) => file.path.includes("/.agents/")));
    await deployFolder(cloud, { cwd: body.repo.cwd, wait: true });
    assert.equal(uploads[1].projectId, "project-fixture");
    for (const args of [["add", "index.html", ".omg/project.json"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "Save fixture website and deploy identity"]]) {
      assert.equal(Bun.spawnSync(["git", "-C", body.repo.cwd, ...args]).exitCode, 0);
    }
    const future = await (await post("/api/sessions/new", { cwd: body.repo.cwd, prompt: "Improve this website", agent: "codex" })).json() as any;
    assert.ok(future.sessionId, JSON.stringify(future));
    assert.notEqual(future.session.project, "");
    assert.equal(loadProjectLink(future.cwd)?.projectId, "project-fixture");
    assert.equal(await readFile(join(future.cwd, "index.html"), "utf8"), "<h1>Demo site</h1>");
  } finally {
    await client.close();
    await mcp.close();
  }
  console.log("PASS: real HTTP handler isolates no-project chats, preserves prompts, validates conflicts, and replays safely");
} finally {
  server.stop(true);
  await rm(root, { recursive: true, force: true });
}
process.exit(0);
