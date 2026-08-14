import { describe, expect, test } from "bun:test";
import { resolveInitialAgent } from "./coding-agent-options";

describe("resolveInitialAgent", () => {
  test("uses the host default when no saved agent exists", () => {
    expect(resolveInitialAgent(null, "opencode")).toBe("opencode");
  });

  test("keeps a valid saved selection", () => {
    expect(resolveInitialAgent("codex-aisdk", "opencode")).toBe("codex-aisdk");
  });

  test("rejects an invalid saved selection", () => {
    expect(resolveInitialAgent("managed-anthropic", "opencode")).toBe("opencode");
  });
});
