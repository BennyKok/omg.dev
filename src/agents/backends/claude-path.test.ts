import { describe, expect, test } from "bun:test";
import { resolveClaudePath } from "./claude-path.ts";

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
