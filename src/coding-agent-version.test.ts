import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { codingAgentVersion } from "./coding-agent-version.ts";

let dir: string;
beforeEach(() => {
  const root = join(homedir(), ".cache", "lfg", "tmp");
  mkdirSync(root, { recursive: true });
  dir = mkdtempSync(join(root, "agent-version-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

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
