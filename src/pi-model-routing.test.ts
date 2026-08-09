import { expect, test } from "bun:test";
import { piModelTarget } from "./agents/backends/pi-session.ts";
import {
  PI_CODEX_MODELS,
  PI_MODELS,
  PI_OPENCODE_MODELS,
  accessibleModelsForAgent,
} from "./agent-catalog.ts";

test("unprefixed pi models stay on Anthropic", () => {
  for (const model of ["sonnet", "opus", "haiku", "fable"]) {
    expect(piModelTarget(model)).toEqual({ provider: "anthropic", model });
  }
});

test("a slash alone does not mean another provider", () => {
  // pi's Anthropic provider carries slashed custom ids of its own, registered
  // by ensurePiProviderConfig(). Splitting on the first slash would have sent
  // this one to a provider named "deepseek" that does not exist.
  expect(piModelTarget("deepseek/deepseek-v4-flash")).toEqual({
    provider: "anthropic",
    model: "deepseek/deepseek-v4-flash",
  });
});

test("a known provider prefix is split into --provider and --model", () => {
  expect(piModelTarget("openai-codex/gpt-5.6-sol")).toEqual({
    provider: "openai-codex",
    model: "gpt-5.6-sol",
  });
  expect(piModelTarget("opencode/claude-opus-4-8")).toEqual({
    provider: "opencode",
    model: "claude-opus-4-8",
  });
});

test("only the first slash splits, so nested model ids survive", () => {
  expect(piModelTarget("opencode/vendor/model-1")).toEqual({
    provider: "opencode",
    model: "vendor/model-1",
  });
});

test("every catalogued pi model resolves to a provider pi can be signed into", () => {
  for (const model of PI_MODELS) {
    const target = piModelTarget(model);
    expect(["anthropic", "openai-codex", "opencode"]).toContain(target.provider);
    expect(target.model.length).toBeGreaterThan(0);
  }
});

test("with nothing connected the picker falls back to the plain default list", () => {
  const none = accessibleModelsForAgent("pi", [...PI_MODELS], false, []);
  // pi is reported unconfigured in this state and filtered out of the composer,
  // so this list is a fallback for surfaces that render it anyway — never empty.
  expect(none).toEqual(["fable", "opus", "sonnet", "haiku"]);
  expect(none.some((m) => PI_CODEX_MODELS.includes(m))).toBe(false);
  expect(none.some((m) => PI_OPENCODE_MODELS.includes(m))).toBe(false);
});

test("connecting only ChatGPT does not offer Anthropic models", () => {
  // The whole point of gating: pi's default model is `sonnet`, so leaving the
  // Anthropic aliases visible would launch against Anthropic with no Anthropic
  // credential the moment someone connected ChatGPT alone.
  const codexOnly = accessibleModelsForAgent("pi", [...PI_MODELS], false, [
    { id: "anthropic", connected: false },
    { id: "openai-codex", connected: true },
    { id: "opencode", connected: false },
  ]);
  expect(codexOnly).toEqual(PI_CODEX_MODELS);
  expect(codexOnly).not.toContain("sonnet");
  expect(codexOnly).not.toContain("deepseek/deepseek-v4-flash");
});

test("connecting Anthropic brings back the unprefixed models and its custom ids", () => {
  const anthropicOnly = accessibleModelsForAgent("pi", [...PI_MODELS], false, [
    { id: "anthropic", connected: true },
    { id: "openai-codex", connected: false },
    { id: "opencode", connected: false },
  ]);
  expect(anthropicOnly).toEqual([
    "fable",
    "opus",
    "sonnet",
    "haiku",
    "deepseek/deepseek-v4-flash",
  ]);
});

test("connecting every provider reveals the whole catalogue", () => {
  const all = accessibleModelsForAgent("pi", [...PI_MODELS], false, [
    { id: "anthropic", connected: true },
    { id: "openai-codex", connected: true },
    { id: "opencode", connected: true },
  ]);
  expect(all).toEqual(PI_MODELS);
});

test("pi gating does not disturb the opencode agent's own free-tier rule", () => {
  // accessibleModelsForAgent branches on the agent key first; the pi branch
  // must not swallow the opencode agent, which has an unrelated rule.
  const models = ["opencode/deepseek-v4-flash-free", "opencode/claude-opus-4-8"];
  expect(accessibleModelsForAgent("opencode", models, false)).toEqual([
    "opencode/deepseek-v4-flash-free",
  ]);
  expect(accessibleModelsForAgent("opencode", models, true)).toEqual(models);
});
