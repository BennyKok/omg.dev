import { describe, expect, test } from "bun:test";
import {
  codexModelSupportsFast,
  withCodexServiceTierConfig,
} from "./service-tier.ts";

describe("Codex service tier", () => {
  test("recognizes the supported Fast model families", () => {
    expect(codexModelSupportsFast("gpt-5.6-sol")).toBe(true);
    expect(codexModelSupportsFast("gpt-5.6-luna")).toBe(true);
    expect(codexModelSupportsFast("gpt-5.5")).toBe(true);
    expect(codexModelSupportsFast("gpt-5.4")).toBe(true);
    expect(codexModelSupportsFast("gpt-5.4-mini")).toBe(false);
    expect(codexModelSupportsFast("gpt-5.3-codex-spark")).toBe(false);
  });

  test("adds the Codex Fast overrides without losing MCP config", () => {
    expect(withCodexServiceTierConfig({
      mcp_servers: { omg: { env: { OMG_SESSION_ID: "sid" } } },
      features: { another_feature: true },
    }, "fast")).toEqual({
      mcp_servers: { omg: { env: { OMG_SESSION_ID: "sid" } } },
      service_tier: "fast",
      features: { another_feature: true, fast_mode: true },
    });
  });

  test("ordinary launches keep their config unchanged", () => {
    const base = { mcp_servers: { omg: { env: { OMG_SESSION_ID: "sid" } } } };
    expect(withCodexServiceTierConfig(base, undefined)).toBe(base);
  });
});
