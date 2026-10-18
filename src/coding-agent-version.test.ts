import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { codingAgentVersion, setCodingAgentVersionStoreForTests } from "./coding-agent-version.ts";

let dir: string;
beforeEach(() => {
  const root = join(homedir(), ".cache", "lfg", "tmp");
  mkdirSync(root, { recursive: true });
  dir = mkdtempSync(join(root, "agent-version-"));
  setCodingAgentVersionStoreForTests(join(dir, "versions.json"));
});
afterEach(() => {
  setCodingAgentVersionStoreForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

const probes = (path: string) => existsSync(`${path}.count`) ? readFileSync(`${path}.count`, "utf8").trim().split("\n").length : 0;
// A new process: the in-memory answers are gone, the stored ones remain.
const restart = () => setCodingAgentVersionStoreForTests(join(dir, "versions.json"));

function cli(body: string, name = "agent") {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n[ "$1" = "--version" ] || exit 1\n${body}\n`, { mode: 0o755 });
  return path;
}

test("reads a named CLI version and strips terminal color", async () => {
  expect(await codingAgentVersion(cli("printf '\x1b[32mcodex-cli 0.159.2\x1b[0m\\n'"))).toBe("0.159.2");
});

test("preserves prerelease and build information from stderr", async () => {
  expect(await codingAgentVersion(cli("echo '1.2.3-beta.1+abc123' >&2"))).toBe("1.2.3-beta.1+abc123");
});

test("does not report a version for missing, failed, or unsupported CLIs", async () => {
  expect(await codingAgentVersion(null)).toBeUndefined();
  expect(await codingAgentVersion(join(dir, "missing"))).toBeUndefined();
  expect(await codingAgentVersion(cli("echo 'login required'"))).toBeUndefined();
  expect(await codingAgentVersion(cli("echo '1.2.3'; exit 1", "failed"))).toBeUndefined();
  const invalid = join(dir, "invalid");
  writeFileSync(invalid, "invalid executable", { mode: 0o755 });
  expect(await codingAgentVersion(invalid)).toBeUndefined();
});

test("runs the bundled JavaScript runtime through Bun", async () => {
  const path = join(dir, "cli.js");
  writeFileSync(path, 'if (process.argv[2] !== "--version") process.exit(1); console.log("0.83.0");');
  expect(await codingAgentVersion(path)).toBe("0.83.0");
});

test("shares an in-flight probe and reuses the cached result", async () => {
  const path = cli("echo probe >> \"$0.count\"; echo '1.2.3'");
  const first = codingAgentVersion(path);
  expect(codingAgentVersion(path)).toBe(first);
  expect(await first).toBe("1.2.3");
  expect(codingAgentVersion(path)).toBe(first);
});

test("detects an updated install even within the cache period", async () => {
  const path = join(dir, "current");
  symlinkSync(cli("echo '1.2.3'", "old"), path);
  expect(await codingAgentVersion(path)).toBe("1.2.3");
  rmSync(path);
  symlinkSync(cli("echo '2.0.0'", "new"), path);
  expect(await codingAgentVersion(path)).toBe("2.0.0");
});

test("bounds a stalled version probe", async () => {
  expect(await codingAgentVersion(cli("exec sleep 30"))).toBeUndefined();
}, 5000);

// The first /api/bootstrap after a start waited on every CLI's --version, and
// one slow CLI (cursor-agent, 1.4 to 1.7 s) set the whole cold bootstrap.
test("after a restart, an unchanged CLI is answered from disk without running it", async () => {
  const path = cli("echo probe >> \"$0.count\"; echo '1.2.3'");
  expect(await codingAgentVersion(path)).toBe("1.2.3");
  restart();
  expect(await codingAgentVersion(path)).toBe("1.2.3");
  expect(probes(path)).toBe(1);
});

test("after a restart, a CLI whose file changed is asked again", async () => {
  const path = cli("echo '1.2.3'");
  expect(await codingAgentVersion(path)).toBe("1.2.3");
  cli("echo probe >> \"$0.count\"; echo '2.0.0'");
  restart();
  expect(await codingAgentVersion(path)).toBe("2.0.0");
});

test("an old stored answer is served at once and checked again behind the caller", async () => {
  // A wrapper whose own file stays the same while the install behind it moves.
  const path = cli("sleep 0.4; cat \"$0.ver\"");
  writeFileSync(`${path}.ver`, "1.2.3\n");
  expect(await codingAgentVersion(path)).toBe("1.2.3");
  writeFileSync(`${path}.ver`, "2.0.0\n");
  const file = join(dir, "versions.json");
  const saved = JSON.parse(readFileSync(file, "utf8"));
  saved[path].probedAt = Date.now() - 10 * 60_000;
  writeFileSync(file, JSON.stringify(saved));
  restart();
  const t0 = Date.now();
  expect(await codingAgentVersion(path)).toBe("1.2.3");
  expect(Date.now() - t0).toBeLessThan(200);
  await new Promise((r) => setTimeout(r, 1_000));
  expect(await codingAgentVersion(path)).toBe("2.0.0");
});
