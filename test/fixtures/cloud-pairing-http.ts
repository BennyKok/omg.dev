// Isolate server initialization and module state from other tests.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const scratch = join(homedir(), ".cache/lfg/tmp");
await mkdir(scratch, { recursive: true });
const root = await mkdtemp(join(scratch, "cloud-pairing-http-"));
process.env.OMG_DATA_DIR = join(root, "data");
process.env.LFG_REPOS_ROOT = join(root, "projects");
process.env.LFG_WORKTREE_ROOT = join(root, "worktrees");

try {
  const { cmdServe } = await import("../../src/commands/serve");
  let handler: Parameters<typeof Bun.serve>[0]["fetch"];
  const originalServe = Bun.serve;
  const captured = new Error("Captured router before background services start");
  Bun.serve = ((options: Parameters<typeof Bun.serve>[0]) => {
    handler = options.fetch;
    throw captured;
  }) as typeof Bun.serve;
  try {
    await cmdServe();
  } catch (error) {
    if (error !== captured) throw error;
  } finally {
    Bun.serve = originalServe;
  }
  assert.equal(typeof handler, "function");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler! });
  try {
    for (const method of ["GET", "POST"]) {
      const response = await fetch(new URL("/api/cloud/pairing", server.url), { method });
      assert.equal(response.status, 410, `${method} must reach the retirement response`);
      assert.match(response.headers.get("content-type") ?? "", /application\/json/);
      assert.deepEqual(await response.json(), { error: "Connecting your own computer has been removed." });
    }
  } finally {
    await server.stop(true);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
process.exit(0);
