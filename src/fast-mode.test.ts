import { describe, expect, test } from "bun:test";
import { agentSupportsFastMode, resolveSessionFastMode } from "./fast-mode.ts";

describe("session Fast mode", () => {
  test("supports Codex and Claude without coupling to thinking effort", () => {
    expect(agentSupportsFastMode("codex-aisdk")).toBe(true);
    expect(agentSupportsFastMode("aisdk")).toBe(true);
    expect(agentSupportsFastMode("opencode")).toBe(false);

    expect(resolveSessionFastMode({
      requested: true,
      agent: "codex-aisdk",
      model: "gpt-5.6-sol",
    })).toEqual({ ok: true, enabled: true, serviceTier: "fast" });
    expect(resolveSessionFastMode({
      requested: true,
      agent: "aisdk",
      model: "opus",
    })).toEqual({ ok: true, enabled: true });
  });

  test("accepts explicit off and the old Tibo serviceTier request", () => {
    expect(resolveSessionFastMode({
      requested: false,
      agent: "aisdk",
      model: "opus",
    })).toEqual({ ok: true, enabled: false });
    expect(resolveSessionFastMode({
      requested: undefined,
      legacyServiceTier: "fast",
      agent: "codex-aisdk",
      model: "gpt-5.6-luna",
    })).toEqual({ ok: true, enabled: true, serviceTier: "fast" });
  });

  test("rejects unsupported agents, Codex models, and malformed values", () => {
    expect(resolveSessionFastMode({
      requested: true,
      agent: "opencode",
      model: "zai/glm",
    })).toEqual({ ok: false, error: "Fast mode is not supported for opencode sessions" });
    expect(resolveSessionFastMode({
      requested: true,
      agent: "codex-aisdk",
      model: "gpt-5.3-codex-spark",
    })).toEqual({
      ok: false,
      error: 'Fast mode is not supported for model "gpt-5.3-codex-spark"',
    });
    expect(resolveSessionFastMode({
      requested: "on",
      agent: "aisdk",
      model: "opus",
    })).toEqual({ ok: false, error: "fastMode must be a boolean" });
  });
});
