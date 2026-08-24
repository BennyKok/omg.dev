// resolveAutoAgentRuntime is the single validator for the RUNTIME fields of an
// auto agent: which backend it runs on, which model, which Claude account it
// bills to, which thinking level.
//
// It exists because the Schedules page grew an inline agent/model quick switch
// (PATCH /api/auto/agents/:id) alongside the full editor save (POST
// /api/auto/agents). Those were two chances to write the same rules twice and
// let one rot. auto-agent-route-wiring.test.ts pins that both routes REACH
// this function; this file pins what it actually decides.
import { describe, expect, test } from "bun:test";
import { resolveAutoAgentRuntime } from "./serve.ts";

const ok = (r: ReturnType<typeof resolveAutoAgentRuntime>) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.status}: ${r.error}`);
  return r;
};

describe("backend", () => {
  test("an unknown provider is rejected", () => {
    const r = resolveAutoAgentRuntime({ agent: "not-a-real-agent" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unknown auto agent provider "not-a-real-agent"');
  });

  test("an absent agent stays undefined — that means 'leave the stored one alone'", () => {
    expect(ok(resolveAutoAgentRuntime({})).agent).toBeUndefined();
  });

  test("a known provider passes through", () => {
    expect(ok(resolveAutoAgentRuntime({ agent: "grok" })).agent).toBe("grok");
  });
});

describe("model, validated against the effective backend", () => {
  // The reason fallbackBackend exists. A PATCH that sets only `model` on a grok
  // row carries no `agent` field, so without the fallback the model would be
  // checked against claude's list and every legitimate switch would 400.
  test("a grok model on a grok row is accepted when grok is the fallback", () => {
    const r = resolveAutoAgentRuntime({ model: "grok-4.5" }, "grok");
    expect(r.ok).toBe(true);
  });

  test("the same grok model is rejected when the effective backend is claude", () => {
    const r = resolveAutoAgentRuntime({ model: "grok-4.5" }, "aisdk");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("unknown model");
  });

  test("an explicit agent in the body beats the fallback", () => {
    // Switching claude -> grok and picking a grok model in one write.
    const r = resolveAutoAgentRuntime({ agent: "grok", model: "grok-4.5" }, "aisdk");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.agent).toBe("grok");
  });

  test("a free-form backend still rejects a malformed model name", () => {
    const r = resolveAutoAgentRuntime({ agent: "codex-aisdk", model: "bad model!" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("invalid codex model name");
  });
});

describe("the Claude account pin", () => {
  test("is rejected for a non-Claude backend rather than silently stored", () => {
    const r = resolveAutoAgentRuntime({ agent: "grok", claudeAccountId: "acct-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("claudeAccountId is not supported for grok");
  });

  // The tri-state the POST route's comment calls out, preserved through the
  // extraction: absent means "keep the stored pin", empty means "clear it".
  // Folding both into undefined makes un-pinning impossible.
  test("absent stays undefined and empty becomes null", () => {
    expect(ok(resolveAutoAgentRuntime({})).claudeAccountId).toBeUndefined();
    expect(ok(resolveAutoAgentRuntime({ claudeAccountId: "" })).claudeAccountId).toBeNull();
    expect(ok(resolveAutoAgentRuntime({ claudeAccountId: null })).claudeAccountId).toBeNull();
  });
});

describe("thinking level", () => {
  test("is rejected for a backend with no reasoning knob", () => {
    const r = resolveAutoAgentRuntime({ agent: "opencode", thinkingLevel: "high" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("thinkingLevel is not supported for opencode");
  });

  test("an unknown level for a supporting backend is rejected", () => {
    const r = resolveAutoAgentRuntime({ agent: "aisdk", thinkingLevel: "galaxy-brain" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('unknown thinking level "galaxy-brain"');
  });
});
