import { describe, expect, test } from "bun:test";
import { setupOutcome } from "../packages/protocol/src/coding-agent-setup-outcome.ts";

const done = (key: string, version: string | undefined, ok = true, error?: string) => ({
  key,
  status: { setupRunning: false, version, setupResult: { action: "update" as const, ok, error, finishedAt: 1 } },
});

describe("setupOutcome", () => {
  test("waits while any watched agent still runs", () => {
    expect(
      setupOutcome([{ key: "opencode", label: "OpenCode" }], [{ key: "opencode", status: { setupRunning: true } }]),
    ).toBeNull();
  });

  test("names the version change for one agent", () => {
    expect(
      setupOutcome([{ key: "opencode", label: "OpenCode", fromVersion: "1.2.0" }], [done("opencode", "1.3.0")]),
    ).toMatchObject({ ok: true, title: "OpenCode updated from v1.2.0 to v1.3.0" });
  });

  test("says up to date when the version did not move", () => {
    expect(
      setupOutcome([{ key: "opencode", label: "OpenCode", fromVersion: "1.3.0" }], [done("opencode", "1.3.0")])?.title,
    ).toBe("OpenCode is up to date (v1.3.0)");
  });

  test("a failure carries the error", () => {
    expect(
      setupOutcome([{ key: "codex", label: "Codex" }], [done("codex", "0.1.0", false, "network down")]),
    ).toMatchObject({
      ok: false,
      title: "Codex update failed",
      description: "network down",
      rows: [{ key: "codex", ok: false, line: "Codex update failed", error: "network down" }],
    });
  });

  test("several agents get a count and one line each", () => {
    const outcome = setupOutcome(
      [
        { key: "codex", label: "Codex", fromVersion: "0.1.0" },
        { key: "opencode", label: "OpenCode", fromVersion: "1.2.0" },
      ],
      [done("codex", "0.1.0", false, "network down"), done("opencode", "1.3.0")],
    );
    expect(outcome?.ok).toBe(false);
    expect(outcome?.title).toBe("1 of 2 agents failed to update");
    expect(outcome?.description).toBe("Codex update failed\nOpenCode updated from v1.2.0 to v1.3.0");
  });
});
