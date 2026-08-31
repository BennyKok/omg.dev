import { describe, expect, test } from "bun:test";
import {
  managedAisdkSessionArgv,
  managedCodexAisdkSessionArgv,
  managedCodexSessionArgv,
} from "./tmux.ts";

function configOverrides(argv: string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === "-c") values.push(argv[i + 1]);
  }
  return values;
}

describe("Codex Fast launch transport", () => {
  test("direct Codex receives Fast service-tier config", () => {
    const argv = managedCodexSessionArgv({
      name: "lfg-fast-test",
      cwd: "/tmp/lfg-fast-test",
      model: "gpt-5.6-sol",
      thinkingLevel: "high",
      serviceTier: "fast",
    });

    expect(configOverrides(argv)).toContain('service_tier="fast"');
    expect(configOverrides(argv)).toContain("features.fast_mode=true");
    expect(configOverrides(argv)).toContain('reasoning_effort="high"');
  });

  test("the Codex SDK harness receives Fast as an explicit launch argument", () => {
    const argv = managedCodexAisdkSessionArgv({
      name: "lfg-fast-test",
      cwd: "/tmp/lfg-fast-test",
      model: "gpt-5.6-sol",
      key: "session-key",
      thinkingLevel: "high",
      serviceTier: "fast",
    });

    expect(argv.slice(argv.indexOf("--service-tier"), argv.indexOf("--service-tier") + 2)).toEqual([
      "--service-tier",
      "fast",
    ]);
    expect(argv.slice(argv.indexOf("--thinking-level"), argv.indexOf("--thinking-level") + 2)).toEqual([
      "--thinking-level",
      "high",
    ]);
  });

  test("ordinary launches do not receive Fast config", () => {
    const direct = managedCodexSessionArgv({
      name: "lfg-default-test",
      cwd: "/tmp/lfg-default-test",
      model: "gpt-5.6-sol",
    });
    const sdk = managedCodexAisdkSessionArgv({
      name: "lfg-default-test",
      cwd: "/tmp/lfg-default-test",
      model: "gpt-5.6-sol",
      key: "session-key",
    });

    expect(configOverrides(direct)).not.toContain('service_tier="fast"');
    expect(sdk).not.toContain("--service-tier");
  });
});

describe("Claude Fast launch transport", () => {
  test("passes Fast separately from a lower effort", () => {
    const argv = managedAisdkSessionArgv({
      name: "lfg-claude-fast-test",
      cwd: "/tmp/lfg-claude-fast-test",
      model: "opus",
      sessionId: "session-key",
      thinkingLevel: "low",
      fastMode: true,
    });

    expect(argv).toContain("--fast-mode");
    expect(argv.slice(argv.indexOf("--thinking-level"), argv.indexOf("--thinking-level") + 2)).toEqual([
      "--thinking-level",
      "low",
    ]);
  });

  test("ordinary Claude launches omit Fast", () => {
    expect(managedAisdkSessionArgv({
      name: "lfg-claude-default-test",
      cwd: "/tmp/lfg-claude-default-test",
      model: "opus",
      sessionId: "session-key",
      thinkingLevel: "medium",
    })).not.toContain("--fast-mode");
  });
});
