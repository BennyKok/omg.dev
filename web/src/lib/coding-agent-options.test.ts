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

test("omg is selectable and keeps its saved kind", async () => {
  const { AGENT_CATALOG, configuredAgentOptions } = await import("./coding-agent-options");
  expect(AGENT_CATALOG.find((item) => item.key === "omg")).toEqual({ key: "omg", label: "omg agent", scheduled: true });
  expect(resolveInitialAgent("omg", "opencode")).toBe("omg");
  expect(configuredAgentOptions(AGENT_CATALOG, [{ key: "omg", visible: true, status: { configured: true, accountConnected: true } }], "connected-or-opencode").map((item) => item.key)).toEqual(["omg"]);
});
