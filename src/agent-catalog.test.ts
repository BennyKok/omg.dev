import { describe, expect, test } from "bun:test";
import {
  accessibleModelsForAgent,
  curateCursorModels,
  curateOpenCodeModels,
  defaultModelForAgent,
  discoveredModelsOrFallback,
  listModelCatalog,
  MODEL_OPTIONS,
  OPENCODE_MODELS,
} from "./agent-catalog.ts";

const DISCOVERED = [
  "openai/gpt-5.3-codex-spark",
  "openai/gpt-5.4",
  "openai/gpt-5.4-fast",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.5",
  "openai/gpt-5.5-fast",
  "openai/gpt-5.6",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-sol-pro",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-terra-fast",
  "opencode/deepseek-v4-flash-free",
  "opencode/future-coder-free",
  "opencode-go/kimi-k3",
  "opencode-go/kimi-k2.7-code",
  "sakana/fugu",
];

describe("curateOpenCodeModels", () => {
  test("surfaces ChatGPT/Codex models ahead of the go catalog", () => {
    const out = curateOpenCodeModels(DISCOVERED);
    expect(out.slice(0, 4)).toEqual([
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-luna",
      "openai/gpt-5.5",
    ]);
    expect(out).toContain("openai/gpt-5.4-mini");
    expect(out).toContain("openai/gpt-5.3-codex-spark");
  });

  test("adds the newest plain flagship without fast/pro variants", () => {
    const out = curateOpenCodeModels(DISCOVERED);
    expect(out).toContain("openai/gpt-5.6");
    expect(out).not.toContain("openai/gpt-5.6-sol-pro");
    expect(out).not.toContain("openai/gpt-5.5-fast");
  });

  test("keeps the existing go families after the openai block", () => {
    const out = curateOpenCodeModels(DISCOVERED);
    expect(out.indexOf("openai/gpt-5.6-sol")).toBeLessThan(out.indexOf("opencode-go/kimi-k3"));
    expect(out).toContain("sakana/fugu");
  });

  test("retains every dynamic credential-free OpenCode model", () => {
    const out = curateOpenCodeModels(DISCOVERED);
    expect(out).toContain("opencode/deepseek-v4-flash-free");
    expect(out).toContain("opencode/future-coder-free");
  });

  test("falls back to family curation when no openai models are discovered", () => {
    expect(curateOpenCodeModels(["opencode-go/kimi-k3", "openrouter/whatever"])).toEqual([
      "opencode-go/kimi-k3",
    ]);
  });
});

function codingAgent(
  key: "claude" | "aisdk" | "codex" | "codex-aisdk" | "opencode" | "pi",
  accountConnected: boolean,
) {
  return {
    key,
    label: key,
    visible: true,
    status: {
      configured: true,
      accountConnected,
      omgCapabilityAccess: "mcp" as const,
      checks: [],
      instructions: [],
      canAutoSetup: false,
      canLoginInTerminal: false,
      setupRunning: false,
    },
  };
}

describe("OpenCode catalog default", () => {
  test("offers every credential-free anonymous model as the cold fallback", () => {
    // Before the first successful `opencode models` run the picker renders this
    // list verbatim. It must not under-report OpenCode Zen's free tier: a
    // one-entry fallback made new accounts believe a single free model existed.
    expect(OPENCODE_MODELS.length).toBeGreaterThan(1);
    for (const model of OPENCODE_MODELS) expect(model).toMatch(/^opencode\/.+-free$/);
    expect(OPENCODE_MODELS).toContain("opencode/deepseek-v4-flash-free");
    expect(MODEL_OPTIONS.opencode.defaultModel).toBe("opencode/deepseek-v4-flash-free");
    expect(defaultModelForAgent("opencode")).toBe("opencode/deepseek-v4-flash-free");
  });

  test("keeps every cold-fallback model selectable for an anonymous account", () => {
    expect(accessibleModelsForAgent("opencode", [...OPENCODE_MODELS], false)).toEqual([
      ...OPENCODE_MODELS,
    ]);
  });

  test("replaces stale fallback providers with successful live discovery", () => {
    expect(discoveredModelsOrFallback(
      ["opencode-go/deepseek-v4-flash"],
      { ok: true, models: ["opencode/deepseek-v4-flash-free"] },
    )).toEqual(["opencode/deepseek-v4-flash-free"]);
  });

  test("uses the safe fallback only when live discovery is unavailable", () => {
    expect(discoveredModelsOrFallback(
      OPENCODE_MODELS,
      { ok: false, models: [] },
    )).toEqual([...OPENCODE_MODELS]);
  });

  test("selects a live free model when no user-owned account is connected", () => {
    const opencode = listModelCatalog([codingAgent("opencode", false)]).find(
      (item) => item.key === "opencode",
    );
    expect(opencode?.defaultModel).toMatch(/^opencode\/.+-free$/);
    expect(opencode?.models).toContain(opencode?.defaultModel);
  });

  test("shows only credential-free OpenCode models before account setup", () => {
    expect(accessibleModelsForAgent("opencode", DISCOVERED, false, [], true)).toEqual([
      "opencode/deepseek-v4-flash-free",
      "opencode/future-coder-free",
    ]);
  });

  test("keeps discovered provider models after account setup", () => {
    expect(accessibleModelsForAgent("opencode", DISCOVERED, true, [], true)).toEqual(DISCOVERED);
  });

  // The bug this pins: a connected Claude account is not an OpenCode
  // credential. It used to unlock the whole OpenCode catalog anyway, so a box
  // whose `opencode` had never been signed into offered openai/* and
  // opencode-go/* — models that fail the moment they launch — and hid the free
  // Zen models it could actually run.
  test("does not let another agent's account unlock OpenCode's paid providers", () => {
    expect(accessibleModelsForAgent("opencode", DISCOVERED, true, [], false)).toEqual([
      "opencode/deepseek-v4-flash-free",
      "opencode/future-coder-free",
    ]);
  });

  test("keeps the free default when only a Claude account is connected", () => {
    const opencode = listModelCatalog([
      codingAgent("aisdk", true),
      codingAgent("opencode", false),
    ]).find((item) => item.key === "opencode");
    expect(opencode?.defaultModel).toMatch(/^opencode\/.+-free$/);
    for (const model of opencode?.models ?? []) expect(model).toMatch(/^opencode\/.+-free$/);
  });

  test.each(["claude", "aisdk", "codex", "codex-aisdk"] as const)(
    "keeps the authenticated default for a connected %s account",
    (key) => {
      const opencode = listModelCatalog([codingAgent(key, true), codingAgent("opencode", true)]).find(
        (item) => item.key === "opencode",
      );
      expect(opencode?.defaultModel).toBe("opencode/deepseek-v4-flash-free");
    },
  );

  test("does not treat OpenCode's installed runtime as a user-owned account", () => {
    const opencode = listModelCatalog([codingAgent("opencode", true)]).find(
      (item) => item.key === "opencode",
    );
    expect(opencode?.defaultModel).toMatch(/^opencode\/.+-free$/);
  });
});

// Cursor ships Grok under its own `cursor-` prefix. Curation used to match only
// /^grok-\d/, so when Cursor renamed these ids every Grok build was discovered
// and then silently dropped: `cursor-agent models` returned 14 variants and the
// picker offered none of them. Nothing failed — the family just disappeared,
// which is the failure mode worth pinning.
const CURSOR_DISCOVERED = [
  "auto",
  "composer-2.5",
  "gpt-5.6-sol-high",
  "cursor-grok-4.5-low",
  "cursor-grok-4.5-high",
  "cursor-grok-4.5-high-fast",
  "cursor-grok-4.6-low",
  "cursor-grok-4.6-medium",
  "cursor-grok-4.6-high",
  "cursor-grok-4.6-high-fast",
  "cursor-grok-4.6-xhigh",
];

describe("curateCursorModels", () => {
  test("surfaces Cursor's prefixed Grok builds", () => {
    expect(curateCursorModels(CURSOR_DISCOVERED)).toContain("cursor-grok-4.6");
  });

  test("offers exactly one Grok entry, the newest", () => {
    const grok = curateCursorModels(CURSOR_DISCOVERED).filter((model) => /grok/.test(model));
    expect(grok).toEqual(["cursor-grok-4.6"]);
  });

  test("still matches an unprefixed grok id", () => {
    expect(curateCursorModels(["auto", "grok-4.6-high"])).toContain("grok-4.6");
  });

  test("collapses thinking/fast variants into one base per family", () => {
    const out = curateCursorModels(CURSOR_DISCOVERED);
    for (const model of out) expect(model).not.toMatch(/-(fast|xhigh|high|medium|low)$/);
  });
});
