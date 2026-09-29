import { describe, expect, test } from "bun:test";
import { describeClaudeBinary, resolveClaudePath } from "./claude-path.ts";

describe("resolveClaudePath", () => {
  test("an explicit override wins", () => {
    expect(resolveClaudePath({ LFG_CLAUDE_PATH: "/opt/claude" })).toBe("/opt/claude");
  });

  test("an EMPTY override falls through to PATH instead of winning", () => {
    // The regression: `.env.example` shipped `OMG_CLAUDE_PATH=`, the service
    // unit exports it with `set -a`, and applyEnvAliases mirrors the empty
    // string onto LFG_CLAUDE_PATH. A `??` check returned "" here, which is
    // falsy at the call site, so pathToClaudeCodeExecutable was silently
    // dropped and the SDK looked for a bundled native binary that a tarball
    // install does not ship — every managed session died at launch.
    const resolved = resolveClaudePath({ LFG_CLAUDE_PATH: "" });
    expect(resolved).not.toBe("");
    expect(resolved).toBe(Bun.which("claude") ?? undefined);
  });

  test("a whitespace-only override is treated as unset", () => {
    expect(resolveClaudePath({ LFG_CLAUDE_PATH: "   " })).toBe(Bun.which("claude") ?? undefined);
  });

  test("no override falls through to PATH", () => {
    expect(resolveClaudePath({})).toBe(Bun.which("claude") ?? undefined);
  });

  test("returns undefined, never an empty string, when nothing resolves", () => {
    const resolved = resolveClaudePath({ LFG_CLAUDE_PATH: "" });
    expect(resolved === undefined || resolved.length > 0).toBe(true);
  });
});

describe("resolveClaudePath fallback to the installed binary", () => {
  const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");

  test("finds ~/.local/bin/claude when PATH does not contain it", () => {
    const home = mkdtempSync(join(import.meta.dir, ".claude-path-home-"));
    try {
      const versions = join(home, ".local", "share", "claude", "versions");
      mkdirSync(versions, { recursive: true });
      mkdirSync(join(home, ".local", "bin"), { recursive: true });
      writeFileSync(join(versions, "2.1.283"), "#!/bin/sh\n", { mode: 0o755 });
      const link = join(home, ".local", "bin", "claude");
      symlinkSync(join(versions, "2.1.283"), link);
      const resolved = resolveClaudePath({ HOME: home, PATH: "/nonexistent" });
      expect(resolved).toBe(link);
      expect(describeClaudeBinary(resolved)).toContain("2.1.283");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("names the bundled fallback when nothing is installed", () => {
    const home = mkdtempSync(join(import.meta.dir, ".claude-path-home-"));
    try {
      expect(resolveClaudePath({ HOME: home, PATH: "/nonexistent" })).toBeUndefined();
      expect(describeClaudeBinary(undefined)).toContain("SDK bundled");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
