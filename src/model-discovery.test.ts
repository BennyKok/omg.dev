import { describe, expect, test } from "bun:test";
import {
  providersDueForRetry,
  parseFxModels,
  parseJcodeModels,
  parseOpenCodeModels,
  retryDelayMs,
  type ModelDiscoveryCache,
  type DiscoveredModelProvider,
} from "./model-discovery.ts";

function provider(
  key: DiscoveredModelProvider["key"],
  patch: Partial<DiscoveredModelProvider> = {},
): DiscoveredModelProvider {
  return {
    key,
    ok: true,
    models: ["a"],
    refreshedAt: 0,
    durationMs: 1,
    ...patch,
  };
}

/**
 * A cache where every probed provider is healthy unless the test overrides it,
 * so an assertion names only the providers it is actually about. Absent keys
 * are due for discovery in their own right, which would otherwise bleed into
 * every expectation.
 */
function cache(
  providers: Partial<Record<DiscoveredModelProvider["key"], DiscoveredModelProvider>>,
): ModelDiscoveryCache {
  return {
    version: 1,
    refreshedAt: 0,
    schedule: "0 8 * * *",
    timeZone: "UTC",
    providers: {
      codex: provider("codex"),
      grok: provider("grok"),
      cursor: provider("cursor"),
      fx: provider("fx"),
      opencode: provider("opencode"),
      jcode: provider("jcode"),
      ...providers,
    },
  };
}

const MINUTE = 60_000;

describe("model discovery retry policy", () => {
  test("backs off further on each consecutive failure, then caps", () => {
    expect(retryDelayMs(1)).toBe(MINUTE);
    expect(retryDelayMs(2)).toBe(2 * MINUTE);
    expect(retryDelayMs(6)).toBe(30 * MINUTE);
    // Capped, not unbounded: a CLI installed later is still picked up.
    expect(retryDelayMs(50)).toBe(30 * MINUTE);
    expect(retryDelayMs(0)).toBe(MINUTE);
  });

  test("retries a failed provider once its backoff elapses", () => {
    const c = cache({
      opencode: provider("opencode", { ok: false, models: [], failedAttempts: 1, refreshedAt: 0 }),
    });
    expect(providersDueForRetry(c, 59_000)).toEqual([]);
    expect(providersDueForRetry(c, MINUTE)).toEqual(["opencode"]);
  });

  test("honours the longer backoff after repeated failures", () => {
    const c = cache({
      opencode: provider("opencode", { ok: false, models: [], failedAttempts: 3, refreshedAt: 0 }),
    });
    expect(providersDueForRetry(c, 4 * MINUTE)).toEqual([]);
    expect(providersDueForRetry(c, 5 * MINUTE)).toEqual(["opencode"]);
  });

  test("leaves healthy providers alone", () => {
    const c = cache({ opencode: provider("opencode", { ok: true, refreshedAt: 0 }) });
    expect(providersDueForRetry(c, 10 * MINUTE)).toEqual([]);
  });

  test("never retries harnesses that expose no model-list command", () => {
    // claude/aisdk fail identically on every probe, so retrying them would
    // spin a subprocess every tick and never change the answer.
    const c = cache({
      claude: provider("claude", { ok: false, models: [], failedAttempts: 1, refreshedAt: 0 }),
      aisdk: provider("aisdk", { ok: false, models: [], failedAttempts: 1, refreshedAt: 0 }),
    });
    expect(providersDueForRetry(c, 24 * 60 * MINUTE)).toEqual([]);
  });

  test("discovers a provider missing from an older cache", () => {
    const older: ModelDiscoveryCache = {
      version: 1,
      refreshedAt: 0,
      schedule: "0 8 * * *",
      timeZone: "UTC",
      providers: { codex: provider("codex") },
    };
    expect(providersDueForRetry(older, 0)).toEqual(["grok", "cursor", "fx", "opencode", "jcode"]);
  });

  test("no cache means the initial full refresh owns it, not the retry path", () => {
    expect(providersDueForRetry(null, Date.now())).toEqual([]);
  });

  test("a boxed-in provider does not starve the others", () => {
    const c = cache({
      codex: provider("codex", { ok: true, refreshedAt: 0 }),
      opencode: provider("opencode", { ok: false, models: [], failedAttempts: 1, refreshedAt: 0 }),
      cursor: provider("cursor", { ok: false, models: [], failedAttempts: 6, refreshedAt: 0 }),
    });
    expect(providersDueForRetry(c, 2 * MINUTE)).toEqual(["opencode"]);
    expect(providersDueForRetry(c, 30 * MINUTE)).toEqual(["cursor", "opencode"]);
  });
});

describe("fx model discovery", () => {
  // Shape captured from `fx models --json` against fx 0.0.3. It needs no
  // credential, so discovery answers before the user has signed in.
  test("reads the gateway id list and puts LFG's own auto placeholder first", () => {
    expect(
      parseFxModels(
        JSON.stringify({
          kind: "models",
          count: 3,
          ids: ["anthropic/claude-opus-5", "openai/gpt-5.6-sol", "zai/glm-5.2"],
        }),
      ),
    ).toEqual({
      models: ["auto", "anthropic/claude-opus-5", "openai/gpt-5.6-sol", "zai/glm-5.2"],
      labels: {},
    });
  });

  test("survives a catalog with no ids at all", () => {
    expect(parseFxModels(JSON.stringify({ kind: "models", count: 0 }))).toEqual({
      models: ["auto"],
      labels: {},
    });
  });
});

describe("Jcode model discovery", () => {
  test("reads the structured Jcode model list and skips unavailable models", () => {
    expect(
      parseJcodeModels(
        JSON.stringify({
          models: [
            { provider: "OpenCode Zen", model: "glm-5", available: true },
            { provider: "OpenAI", model: "gpt-5", available: false },
            { provider: "omg-e2e", model: "e2e-model", available: true },
          ],
        }),
      ),
    ).toEqual({ models: ["auto", "glm-5", "e2e-model"], labels: {} });
  });
});

describe("OpenCode model discovery", () => {
  test("reads provider variants from verbose model output", () => {
    const parsed = parseOpenCodeModels(`zai-coding-plan/glm-5.3
{
  "id": "glm-5.3",
  "providerID": "zai-coding-plan",
  "name": "GLM-5.3",
  "variants": {
    "low": { "reasoningEffort": "low" },
    "high": { "reasoningEffort": "high" },
    "max": { "reasoningEffort": "max" }
  }
}
opencode/deepseek-v4-flash-free
{
  "id": "deepseek-v4-flash-free",
  "providerID": "opencode",
  "name": "DeepSeek V4 Flash Free",
  "variants": {}
}`);

    expect(parsed.models).toEqual([
      "zai-coding-plan/glm-5.3",
      "opencode/deepseek-v4-flash-free",
    ]);
    expect(parsed.labels).toEqual({
      "zai-coding-plan/glm-5.3": "GLM-5.3",
      "opencode/deepseek-v4-flash-free": "DeepSeek V4 Flash Free",
    });
    expect(parsed.variants).toEqual({
      "zai-coding-plan/glm-5.3": ["low", "high", "max"],
    });
  });
});
