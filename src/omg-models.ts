// The cheapest hosted model owns small internal tasks such as session titles.
// Keep this explicit: picker order is a UX choice, not a pricing contract.
export const OMG_CHEAPEST_MODEL = "omg/deepseek/deepseek-v4-flash-0731";

/**
 * The model a new omg session runs when nothing names one: first run,
 * scheduled tasks, and any client that sends no model. One constant; set it
 * back to OMG_CHEAPEST_MODEL to revert.
 *
 * claude-haiku-5.5 (user decision, 2026-10-12, after the Opus 5.5 app
 * benchmark). It reads images and runs at its own default thinking level.
 * Before that the default was gpt-6-luna (2026-09-30); set it back to
 * "omg/openai/gpt-6-luna" to revert. The hosted default lives in vibes
 * control-plane/lib/omg-agent-models.ts and must move with this one.
 */
/**
 * Router aliases the hosted platform resolves per person (vibes
 * apps/infra/internal/proxy/model_alias.go). "Auto" lets the platform choose;
 * Max, Balanced and Fast are the manual levels. Their concrete models can be
 * re-pointed on the router, for one person, a plan or everyone, without an
 * lfg release. The "omg/" prefix is the provider; the router id is "omg/auto".
 */
export const OMG_AUTO_MODEL = "omg/omg/auto";
export const OMG_LEVEL_MODELS: readonly string[] = [
  OMG_AUTO_MODEL,
  "omg/omg/max",
  "omg/omg/balanced",
  "omg/omg/fast",
];

/**
 * The first build of a new app on Auto (src/auto-build-model.ts). Listed so
 * the session can launch on it; the picker does not offer it.
 */
export const OMG_BUILD_MODEL = "omg/omg/build";

export function isOmgLevelModel(model: string | null | undefined): boolean {
  return !!model && OMG_LEVEL_MODELS.includes(model);
}

/**
 * The fixed model credit use is compared against. It must be a concrete
 * model: an alias can be re-pointed, and every comparison would move with it.
 */
export const OMG_PRICE_BASELINE_MODEL = "omg/anthropic/claude-haiku-5.5";

// Auto since 2026-10-24 (user decision): the platform picks the model. Before
// that it was claude-haiku-5.5, which is also Auto's router default. Set it
// back to OMG_PRICE_BASELINE_MODEL to revert.
export const OMG_DEFAULT_MODEL = OMG_AUTO_MODEL;

// Shared by the runtime and dashboard. Order is the hosted router picker
// order, and the first entry is the default.
export const OMG_MODELS: string[] = [
  ...OMG_LEVEL_MODELS,
  OMG_BUILD_MODEL,
  ...[
    "omg/anthropic/claude-opus-5.5",
    "omg/apex",
    OMG_CHEAPEST_MODEL,
    "omg/deepseek/deepseek-v4-pro",
    "omg/z-ai/glm-5.3-flash",
    "omg/z-ai/glm-5.3",
    "omg/minimax/minimax-m3",
    "omg/moonshotai/kimi-k3.1-pro",
    "omg/x-ai/grok-4.7",
    "omg/anthropic/claude-fable-5.1",
    "omg/anthropic/claude-sonnet-5.5",
    "omg/anthropic/claude-haiku-5.5",
    "omg/openai/gpt-6.1-sol",
    "omg/openai/gpt-6-astra",
    "omg/openai/gpt-6-luna",
  ].filter((model) => !OMG_LEVEL_MODELS.includes(model)),
];

/**
 * Input modalities of each hosted model, keyed like OMG_MODELS.
 *
 * This is the one owner of "can this omg model see an image". OpenCode's
 * openai-compatible provider sends an image part only when the model entry
 * declares image input, and drops it otherwise. ensureOmgProvider writes these
 * into the guest config and modelSeesImages reads them, so the agent's rules
 * and the provider agree.
 *
 * Source: `architecture.input_modalities` for the router id in
 * https://openrouter.ai/api/v1/models (the router forwards to OpenRouter
 * unchanged), read 2026-09-30. Only text and image are listed, because those
 * are the parts OpenCode sends.
 */
const TEXT = ["text"] as const;
const TEXT_IMAGE = ["text", "image"] as const;

export const OMG_INPUT_MODALITIES_BY_MODEL: Record<string, readonly ("text" | "image")[]> = {
  // Router aliases: declared as image-capable so OpenCode sends images. When
  // an alias points at a text-only model, the router describes the image as
  // text first (maybeConvertOpenAIImageInput).
  "omg/omg/auto": TEXT_IMAGE,
  "omg/omg/max": TEXT_IMAGE,
  "omg/omg/balanced": TEXT_IMAGE,
  "omg/omg/fast": TEXT_IMAGE,
  "omg/omg/build": TEXT_IMAGE,
  // Callstack Apex direct gateway, text-only until vision support is verified.
  "omg/apex": TEXT,
  "omg/deepseek/deepseek-v4-flash-0731": TEXT,
  "omg/deepseek/deepseek-v4-pro": TEXT,
  "omg/z-ai/glm-5.3-flash": TEXT_IMAGE,
  "omg/z-ai/glm-5.3": TEXT,
  "omg/minimax/minimax-m3": TEXT_IMAGE,
  // Read 2026-10-24: input_modalities ["text","image","video"].
  "omg/moonshotai/kimi-k3.1-pro": TEXT_IMAGE,
  "omg/x-ai/grok-4.7": TEXT_IMAGE,
  "omg/anthropic/claude-fable-5.1": TEXT_IMAGE,
  "omg/anthropic/claude-opus-5.5": TEXT_IMAGE,
  "omg/anthropic/claude-sonnet-5.5": TEXT_IMAGE,
  "omg/anthropic/claude-haiku-5.5": TEXT_IMAGE,
  "omg/openai/gpt-6.1-sol": TEXT_IMAGE,
  "omg/openai/gpt-6-astra": TEXT_IMAGE,
  // Read 2026-09-30: input_modalities ["file","image","text"].
  "omg/openai/gpt-6-luna": TEXT_IMAGE,
};

/** Input modalities for one hosted model, or null when it is not in the catalog. */
export function omgInputModalities(model: string): readonly ("text" | "image")[] | null {
  return OMG_INPUT_MODALITIES_BY_MODEL[model] ?? null;
}

/**
 * Thinking levels the hosted router honours per model.
 *
 * The omg agent runs through OpenCode's openai-compatible provider, and the
 * router forwards `/openai/v1/chat/completions` to OpenRouter with the body
 * unchanged (vibes apps/infra/internal/proxy/llm.go, the openrouter branch),
 * so a level reaches OpenRouter as `reasoning_effort`. Models with no supported
 * effort parameter get no selector. MiniMax M3 only takes the `reasoning`
 * object, so it has no effort selector.
 */
const OMG_EFFORT_LEVELS = ["low", "medium", "high"] as const;

// Claude Haiku 5.5 runs with reasoning OFF unless the user picks a level.
// Measured 2026-10-13 through the router and OpenRouter: with no `reasoning`
// field it spends the whole output budget on reasoning and writes no code, and
// inside an OpenCode agent loop `reasoning_effort: "minimal"` still escalated.
// Only the `reasoning: { enabled: false }` object held it at 0 reasoning tokens.
const OMG_REASONING_OFF_MODELS: readonly string[] = ["omg/anthropic/claude-haiku-5.5"];
/** The level name that stands for "reasoning off" in the picker and in variants. */
export const OMG_THINKING_OFF = "off";

export const OMG_THINKING_LEVELS_BY_MODEL: Record<string, readonly string[]> = Object.fromEntries(
  [
    "omg/deepseek/deepseek-v4-flash-0731",
    "omg/deepseek/deepseek-v4-pro",
    "omg/z-ai/glm-5.3-flash",
    "omg/z-ai/glm-5.3",
    // reasoning_effort listed on both Moonshot endpoints 2026-10-24.
    "omg/moonshotai/kimi-k3.1-pro",
    "omg/x-ai/grok-4.7",
    "omg/anthropic/claude-fable-5.1",
    "omg/anthropic/claude-opus-5.5",
    "omg/anthropic/claude-sonnet-5.5",
    "omg/anthropic/claude-haiku-5.5",
    "omg/openai/gpt-6.1-sol",
    "omg/openai/gpt-6-astra",
    // reasoning_effort listed 2026-09-30.
    "omg/openai/gpt-6-luna",
  ].map((model) => [model, OMG_REASONING_OFF_MODELS.includes(model) ? [OMG_THINKING_OFF, ...OMG_EFFORT_LEVELS] : OMG_EFFORT_LEVELS]),
);

/** Levels for one hosted model, or null when the router has no control for it. */
export function omgThinkingLevels(model: string): readonly string[] | null {
  return OMG_THINKING_LEVELS_BY_MODEL[model] ?? null;
}

/** The level a new session starts at when the model has its own default, else null. */
export function omgDefaultThinkingLevel(model: string): string | null {
  return OMG_REASONING_OFF_MODELS.includes(model) ? OMG_THINKING_OFF : null;
}

/**
 * Model-level OpenCode `options`, merged into every request body. Only the
 * reasoning-off models have any: the default request carries
 * `reasoning: { enabled: false }`.
 */
export function omgModelOptions(model: string): Record<string, unknown> | undefined {
  return OMG_REASONING_OFF_MODELS.includes(model) ? { reasoning: { enabled: false } } : undefined;
}

/**
 * The OpenCode variant for one level. OpenCode merges a variant over the model
 * options with a deep merge, so a chosen level sets `enabled: true` itself and
 * cannot be cancelled by the model default. Other models send the level as
 * `reasoning_effort`.
 */
export function omgVariantOptions(model: string, level: string): Record<string, unknown> {
  if (!OMG_REASONING_OFF_MODELS.includes(model)) return { reasoningEffort: level };
  return level === OMG_THINKING_OFF
    ? { reasoning: { enabled: false } }
    : { reasoning: { enabled: true, effort: level } };
}
