import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs the Expo template's preview script against a stub `expo` binary that
// answers like Metro. Expo Go on a physical iPhone refuses a dev server whose
// manifest has no extra.expoGo.username, so the script must say which case
// the Computer is in.

const SCRIPT = join(import.meta.dir, "..", "agents", "templates", "expo", "scripts", "start-expo-preview.sh");

const STUB = `#!/usr/bin/env bash
port=""
while [ $# -gt 0 ]; do [ "$1" = "--port" ] && port="$2"; shift; done
export STUB_PORT="$port"
exec bun -e '
const port = Number(process.env.STUB_PORT);
const user = process.env.STUB_USER || undefined;
Bun.serve({ hostname: "127.0.0.1", port, fetch(req) {
  const url = new URL(req.url);
  if (url.pathname === "/status") return new Response("packager-status:running");
  if (url.pathname === "/index.bundle") return new Response("bundle");
  if (url.pathname === "/" && req.headers.get("expo-platform")) {
    return Response.json({
      launchAsset: { url: "http://proxy.invalid/index.bundle?platform=ios" },
      extra: { expoGo: user ? { username: user } : { developer: { tool: "expo-cli" } } },
    });
  }
  return new Response("<html></html>");
} });
'
`;

async function freeMetroPort(): Promise<number> {
  for (let port = 8099; port >= 8081; port--) {
    try {
      const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("") });
      server.stop(true);
      return port;
    } catch {}
  }
  throw new Error("no free Metro port from 8081 to 8099");
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

async function runPreview(user: string | undefined): Promise<{ code: number; out: string }> {
  const root = mkdtempSync(join(tmpdir(), "lfg-expo-preview-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  cpSync(SCRIPT, join(root, "scripts", "start-expo-preview.sh"));
  writeFileSync(join(root, "node_modules", ".bin", "expo"), STUB);
  chmodSync(join(root, "node_modules", ".bin", "expo"), 0o755);
  const port = await freeMetroPort();
  const proc = Bun.spawn(["bash", "scripts/start-expo-preview.sh", `http://127.0.0.1:${port}`, String(port)], {
    cwd: root,
    env: { ...process.env, TMPDIR: root, STUB_USER: user ?? "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const pid = Number(/\(pid (\d+),/.exec(out)?.[1]);
  if (pid) cleanups.push(() => {
    try { process.kill(pid); } catch {}
  });
  return { code, out: out + err };
}

describe("start-expo-preview.sh", () => {
  test("warns that an iPhone will refuse the project when Expo CLI is not signed in", async () => {
    const { code, out } = await runPreview(undefined);
    expect(code).toBe(0);
    expect(out).toContain("Sandbox proxy answers: HTTP 200");
    expect(out).toContain("WARNING: Expo CLI is not signed in");
    expect(out).not.toContain("Expo CLI account:");
  }, 30_000);

  test("names the account Expo Go must use when Expo CLI is signed in", async () => {
    const { code, out } = await runPreview("pocket-dev");
    expect(code).toBe(0);
    expect(out).toContain("Expo CLI account: pocket-dev. On an iPhone, Expo Go must be signed in as pocket-dev.");
    expect(out).not.toContain("WARNING");
  }, 30_000);
});
