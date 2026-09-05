import { describe, expect, test } from "bun:test";
import {
  codexModelSupportsFast,
  codexServiceTierArgs,
  resolveSessionServiceTier,
  withCodexServiceTierConfig,
} from "./service-tier.ts";

describe("Codex service tier", () => {
  test("recognizes the supported Fast model families", () => {
    expect(codexModelSupportsFast("gpt-6-astra")).toBe(true);
    expect(codexModelSupportsFast("gpt-5.6-sol")).toBe(true);
    expect(codexModelSupportsFast("gpt-5.6-luna")).toBe(true);
    expect(codexModelSupportsFast("gpt-5.5")).toBe(true);
    expect(codexModelSupportsFast("gpt-5.4")).toBe(true);
    expect(codexModelSupportsFast("gpt-5.4-mini")).toBe(false);
    expect(codexModelSupportsFast("gpt-5.3-codex-spark")).toBe(false);
  });

  test("accepts Fast only for supported Codex sessions", () => {
    expect(resolveSessionServiceTier({
      requested: "fast",
      agent: "codex-aisdk",
      model: "gpt-5.6-sol",
    })).toEqual({ ok: true, serviceTier: "fast" });
    expect(resolveSessionServiceTier({
      requested: "fast",
      agent: "aisdk",
      model: "gpt-5.6-sol",
    })).toEqual({ ok: false, error: "Fast service tier is not supported for aisdk sessions" });
    expect(resolveSessionServiceTier({
      requested: "fast",
      agent: "codex-aisdk",
      model: "gpt-5.3-codex-spark",
    })).toEqual({
      ok: false,
      error: 'Fast service tier is not supported for model "gpt-5.3-codex-spark"',
    });
    expect(resolveSessionServiceTier({
      requested: "priority",
      agent: "codex-aisdk",
      model: "gpt-5.6-sol",
    })).toEqual({ ok: false, error: 'unknown service tier (expected "default" or "fast")' });
  });

  test("omitted and default tiers keep ordinary launches unchanged", () => {
    expect(resolveSessionServiceTier({
      requested: undefined,
      agent: "aisdk",
      model: "opus",
    })).toEqual({ ok: true });
    expect(resolveSessionServiceTier({
      requested: "default",
      agent: "codex-aisdk",
      model: "gpt-5.6-sol",
    })).toEqual({ ok: true });
    expect(codexServiceTierArgs()).toEqual([]);
  });

  test("adds both required Codex Fast overrides without losing MCP config", () => {
    expect(codexServiceTierArgs("fast")).toEqual([
      "-c",
      'service_tier="fast"',
      "-c",
      "features.fast_mode=true",
    ]);
    expect(withCodexServiceTierConfig({
      mcp_servers: { omg: { env: { OMG_SESSION_ID: "sid" } } },
      features: { another_feature: true },
    }, "fast")).toEqual({
      mcp_servers: { omg: { env: { OMG_SESSION_ID: "sid" } } },
      service_tier: "fast",
      features: { another_feature: true, fast_mode: true },
    });
  });
});
