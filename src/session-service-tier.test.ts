import { describe, expect, test } from "bun:test";
import {
  managedAisdkSessionArgv,
  managedCodexAisdkSessionArgv,
} from "./tmux.ts";

describe("Codex Fast launch transport", () => {
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
    const sdk = managedCodexAisdkSessionArgv({
      name: "lfg-default-test",
      cwd: "/tmp/lfg-default-test",
      model: "gpt-5.6-sol",
      key: "session-key",
    });

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
