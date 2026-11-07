// Drive the real HTTP handler: a secret is saved to the project .env on this
// computer and nowhere else, whatever an old caller asks for.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = await mkdtemp(join(tmpdir(), "omg-secret-http-"));
process.env.OMG_USER = "fixture@example.test";
process.env.OMG_DATA_DIR = join(root, "data");
const project = join(root, "project");
await mkdir(project, { recursive: true });
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
const offBox: string[] = [];
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/sessions/fixture-session/send")) {
    messages.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true });
  }
  if (!url.startsWith(String(server.url))) offBox.push(url);
  return originalFetch(input, init);
}) as typeof fetch;
const post = (path: string, body: unknown) => fetch(new URL(path, server.url), {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const ask = async (secret: Record<string, unknown>) => {
  const response = await post("/api/ask", { question: "Enter LOCAL_TOKEN", sessionId: "fixture-session", wait: false, secret });
  assert.equal(response.status, 200);
  return await response.json() as any;
};
try {
  const first = await ask({ key: "LOCAL_TOKEN", cwd: project });
  const saved = await post(`/api/ask/${first.id}/secret`, { value: "fixture-private" });
  assert.equal(saved.status, 200);
  const body = await saved.json() as any;
  assert.equal(body.saved.key, "LOCAL_TOKEN");
  assert.equal(body.saved.localFile, join(project, ".env"));
  assert.ok(!("cloud" in body.saved));
  assert.equal(await readFile(join(project, ".env"), "utf8"), "LOCAL_TOKEN=fixture-private\n");
  assert.equal((await stat(join(project, ".env"))).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(body).includes("fixture-private"));
  assert.ok(!JSON.stringify(messages).includes("fixture-private"));
  assert.ok(!JSON.stringify(messages).includes("hosted"));
  assert.ok(!(await readFile(join(root, "data/ask/questions.jsonl"), "utf8")).includes("fixture-private"));

  // An old caller that still asks for a hosted save gets a local save only.
  const legacy = await ask({ key: "LOCAL_TOKEN", cwd: project, slug: "linked-app", saveToHosted: true });
  const legacySaved = await post(`/api/ask/${legacy.id}/secret`, { value: "fixture-legacy", saveToHosted: true });
  assert.equal(legacySaved.status, 200);
  assert.equal(await readFile(join(project, ".env"), "utf8"), "LOCAL_TOKEN=fixture-legacy\n");

  // A rejected value leaves the ask open for another try.
  const retry = await ask({ key: "LOCAL_TOKEN", cwd: project });
  assert.equal((await post(`/api/ask/${retry.id}/secret`, { value: "" })).status, 400);
  assert.equal((await post(`/api/ask/${retry.id}/secret`, { value: "fixture-retry" })).status, 200);

  // A secret ask with no project folder has nowhere local to go.
  const noFolder = await post("/api/ask", {
    question: "Enter LOCAL_TOKEN", sessionId: "fixture-session", wait: false,
    secret: { key: "LOCAL_TOKEN", slug: "linked-app" },
  });
  assert.equal(noFolder.status, 400);

  // The agent-facing tool, against the same HTTP handler.
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
    const result = await client.callTool({ name: "omg_request_secret", arguments: {
      key: "LOCAL_TOKEN", cwd: project, sessionId: "fixture-session",
    } });
    assert.ok(!result.isError, JSON.stringify(result));
    const data = JSON.parse((result.content as any[])[0].text);
    const response = await post(`/api/ask/${data.id}/secret`, { value: "fixture-mcp" });
    assert.equal(response.status, 200);
    assert.equal(await readFile(join(project, ".env"), "utf8"), "LOCAL_TOKEN=fixture-mcp\n");
  } finally {
    await client.close();
    await mcp.close();
  }
  assert.deepEqual(offBox, []);
  console.log("PASS: secrets are saved to the project .env on this computer only, with no off-box request and no transcript leak");
} finally {
  globalThis.fetch = originalFetch;
  server.stop(true);
  await rm(root, { recursive: true, force: true });
}
process.exit(0);
