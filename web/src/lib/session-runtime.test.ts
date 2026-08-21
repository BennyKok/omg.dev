import { describe, expect, test } from "bun:test";
import { canDriveSession } from "./session-runtime.ts";

describe("command-file session visibility", () => {
  test("keeps every SDK and ACP session in the Live view without a tmux pane", () => {
    for (const agent of ["grok", "cursor", "copilot", "jcode"] as const) {
      expect(
        canDriveSession({
          agent,
          runtime: "command-file",
          tmuxTarget: null,
        }),
      ).toBe(true);
    }
  });

  test("keeps legacy harness rows that predate the runtime field", () => {
    for (const agent of ["aisdk", "codex-aisdk", "opencode"] as const) {
      expect(canDriveSession({ agent, tmuxTarget: null })).toBe(true);
    }
  });

  test("does not treat a pane-less legacy TUI row as driveable", () => {
    expect(canDriveSession({ agent: "cursor", runtime: "tmux", tmuxTarget: null })).toBe(false);
  });
});
