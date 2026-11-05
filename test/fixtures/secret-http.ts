// Isolate the real HTTP handler and its Cloud stub from other tests.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = await mkdtemp(join(tmpdir(), "omg-secret-http-"));
process.env.OMG_USER = "fixture@example.test";
process.env.OMG_DATA_DIR = join(root, "data");
const project = join(root, "project");
await mkdir(join(project, ".omg"), { recursive: true });
await writeFile(join(project, ".omg/project.json"), JSON.stringify({ slug: "linked-app", projectId: "p1", name: "Linked app" }));
const cloud = await import("../../src/cloud-apps");
const cloudWrites: unknown[] = [];
let cloudClients = 0;
mock.module("../../src/cloud-apps", () => ({
  ...cloud,
  createRuntimeAppsClient: () => {
    cloudClients++;
    return { setEnv: async (body: unknown) => { cloudWrites.push(body); } };
  },
}));
const { cmdServe } = await import("../../src/commands/serve");
let handler: any;
const originalServe = Bun.serve;
const captured = new Error("Captured HTTP handler");
Bun.serve = ((options: any) => { handler = options.fetch; throw captured; }) as typeof Bun.serve;
try { await cmdServe(); } catch (error) { if (error !== captured) throw error; }
Bun.serve = originalServe;
assert.equal(typeof handler, "function");
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
const originalFetch = globalThis.fetch;
const messages: unknown[] = [];
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  if (String(input).endsWith("/api/sessions/fixture-session/send")) {
    messages.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true });
  }
  return originalFetch(input, init);
}) as typeof fetch;
const post = (path: string, body: unknown) => fetch(new URL(path, server.url), {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const ask = async (saveToHosted?: boolean) => {
  const response = await post("/api/ask", {
    question: "Enter LOCAL_TOKEN", sessionId: "fixture-session", wait: false,
    secret: { key: "LOCAL_TOKEN", cwd: project, saveToHosted },
  });
  assert.equal(response.status, 200);
  return await response.json() as any;
};
try {
  // The answer only supplies a value. The agent request owns the destination.
  const local = await ask(false);
  const localResponse = await post(`/api/ask/${local.id}/secret`, { value: "fixture-private" });
  assert.equal(localResponse.status, 200);
  const localBody = await localResponse.json() as any;
  assert.equal(localBody.saved.cloud, "skipped");
  assert.equal(cloudClients, 0);
  assert.equal(await readFile(join(project, ".env"), "utf8"), "LOCAL_TOKEN=fixture-private\n");
  assert.ok(!JSON.stringify(localBody).includes("fixture-private"));
  assert.ok(JSON.stringify(messages).includes("local use only"));
  assert.ok(!JSON.stringify(messages).includes("fixture-private"));
  assert.ok(!(await readFile(join(root, "data/ask/questions.jsonl"), "utf8")).includes("fixture-private"));

  const override = await ask(false);
  const off = await post(`/api/ask/${override.id}/secret`, { value: "fixture-override", saveToHosted: true });
  assert.equal(off.status, 200);
  assert.equal((await off.json() as any).saved.cloud, "skipped");
  assert.equal(cloudClients, 0);

  const invalid = await ask();
  const bad = await post(`/api/ask/${invalid.id}/secret`, { value: "" });
  assert.equal(bad.status, 400);
  assert.equal(cloudWrites.length, 0);
  assert.equal(await readFile(join(project, ".env"), "utf8"), "LOCAL_TOKEN=fixture-override\n");
  // A rejected value leaves the ask open. Legacy callers keep hosted saving.
  const legacy = await post(`/api/ask/${invalid.id}/secret`, { value: "fixture-hosted" });
  assert.equal(legacy.status, 200);
  assert.equal((await legacy.json() as any).saved.cloud, "set");
  assert.equal(cloudClients, 2);
  assert.deepEqual(cloudWrites, [{ slug: "linked-app", projectId: "p1", vars: { LOCAL_TOKEN: "fixture-hosted" } }]);

  const noFolder = await post("/api/ask", {
    question: "Enter LOCAL_TOKEN", sessionId: "fixture-session", wait: false,
    secret: { key: "LOCAL_TOKEN", slug: "linked-app", saveToHosted: false },
  });
  assert.equal(noFolder.status, 400);
  // Exercise the agent-facing tool against the same HTTP handler.
  process.env.LFG_BASE = String(server.url);
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { buildOmgMcpServer } = await import("../../src/commands/mcp");
  const mcp = buildOmgMcpServer();
  const client = new Client({ name: "secret-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: "omg_app_env", arguments: {
      action: "request", key: "LOCAL_TOKEN", cwd: project,
      saveToHosted: false, sessionId: "fixture-session",
    } });
    assert.ok(!result.isError, JSON.stringify(result));
    const data = JSON.parse((result.content as any[])[0].text);
    const response = await post(`/api/ask/${data.id}/secret`, { value: "fixture-mcp" });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as any).saved.cloud, "skipped");
    assert.equal(cloudClients, 2);
  } finally {
    await client.close();
    await mcp.close();
  }
  console.log("PASS: secure HTTP saves honor agent-selected destinations despite answer overrides without Cloud writes or transcript leaks");
} finally {
  globalThis.fetch = originalFetch;
  server.stop(true);
  await rm(root, { recursive: true, force: true });
}
process.exit(0);
