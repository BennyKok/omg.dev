import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexBinaryVersion,
  compareCodexVersions,
  parseCodexVersion,
  resolveCodexSessionBinary,
} from "./codex-binary.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "codex-binary-"));
  dirs.push(dir);
  return dir;
}

const GLOBAL = "/home/u/.bun/bin/codex";
function resolve(globalVersion: string | null, bundled: string | null, env: NodeJS.ProcessEnv = {}) {
  return resolveCodexSessionBinary({
    env,
    globalPath: () => GLOBAL,
    versionOf: () => globalVersion,
    bundledVersion: () => bundled,
  });
}

describe("codex version helpers", () => {
  test("parses CLI output and prerelease tags", () => {
    expect(parseCodexVersion("codex-cli 0.169.0\n")).toBe("0.169.0");
    expect(parseCodexVersion("0.171.0-alpha.12")).toBe("0.171.0");
    expect(parseCodexVersion("no version")).toBeNull();
  });

  test("compares numerically, not as text", () => {
    expect(compareCodexVersions("0.169.0", "0.159.2")).toBeGreaterThan(0);
    expect(compareCodexVersions("0.99.0", "0.100.0")).toBeLessThan(0);
    expect(compareCodexVersions("0.169.0", "0.169.0")).toBe(0);
  });
});

describe("resolveCodexSessionBinary", () => {
  test("runs the global CLI when Settings updated it past the bundled copy", () => {
    expect(resolve("0.169.0", "0.159.2")).toBe(GLOBAL);
  });

  test("keeps the bundled copy on a tie", () => {
    expect(resolve("0.169.0", "0.169.0")).toBeUndefined();
  });

  test("never downgrades to an older global CLI", () => {
    expect(resolve("0.150.0", "0.169.0")).toBeUndefined();
  });

  test("keeps the bundled copy when the global version is unreadable", () => {
    expect(resolve(null, "0.169.0")).toBeUndefined();
  });

  test("keeps the bundled copy when no global CLI is installed", () => {
    expect(
      resolveCodexSessionBinary({ env: {}, globalPath: () => null, bundledVersion: () => "0.169.0" }),
    ).toBeUndefined();
  });

  test("an explicit LFG_CODEX_PATH wins over version selection", () => {
    const dir = scratch();
    const bin = join(dir, "codex");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    expect(resolve("0.999.0", "0.1.0", { LFG_CODEX_PATH: bin })).toContain("codex");
    expect(resolve("0.999.0", "0.1.0", { LFG_CODEX_PATH: join(dir, "missing") })).toBeUndefined();
  });
});

describe("codexBinaryVersion", () => {
  test("reads the owning @openai/codex package.json through a bin symlink", () => {
    const dir = scratch();
    const pkg = join(dir, "node_modules", "@openai", "codex");
    mkdirSync(join(pkg, "bin"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@openai/codex", version: "0.169.0" }));
    writeFileSync(join(pkg, "bin", "codex.js"), "#!/usr/bin/env node\n");
    chmodSync(join(pkg, "bin", "codex.js"), 0o755);
    symlinkSync(join(pkg, "bin", "codex.js"), join(dir, "codex"));
    expect(codexBinaryVersion(join(dir, "codex"))).toBe("0.169.0");
  });

  test("asks the binary when no package.json owns it", () => {
    const dir = scratch();
    const bin = join(dir, "codex");
    writeFileSync(bin, "#!/bin/sh\necho 'codex-cli 0.170.2'\n");
    chmodSync(bin, 0o755);
    expect(codexBinaryVersion(bin)).toBe("0.170.2");
  });
});
