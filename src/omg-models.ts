// The cheapest hosted model owns small internal tasks such as session titles.
// Keep this explicit: picker order is a UX choice, not a pricing contract.
export const OMG_CHEAPEST_MODEL = "omg/deepseek/deepseek-v4-flash-0731";

/**
 * The model a new omg session runs when nothing names one: first run,
 * scheduled tasks, and any client that sends no model. One constant; set it
 * back to OMG_CHEAPEST_MODEL to revert.
 *
 * gpt-6-luna (Benny, 2026-09-30): on a real first-run build it finished in
 * 5.3 min for $0.024, 2 of 2 without help, 0 tool errors, and scored 5.65 on
 * design match against 2.65 for deepseek-v4-flash-0731. It reads images.
 */
export const OMG_DEFAULT_MODEL = "omg/openai/gpt-6-luna";

// Shared by the runtime and dashboard. Order is the hosted router picker
// order, and the first entry is the default.
export const OMG_MODELS: string[] = [
  OMG_DEFAULT_MODEL,
  ...[
    "omg/anthropic/claude-opus-5.5",
    "omg/apex",
    OMG_CHEAPEST_MODEL,
    "omg/deepseek/deepseek-v4-pro",
    "omg/z-ai/glm-5.3-flash",
    "omg/z-ai/glm-5.3",
    "omg/minimax/minimax-m3",
    "omg/x-ai/grok-4.7",
    "omg/anthropic/claude-fable-5.1",
    "omg/anthropic/claude-sonnet-5.5",
    "omg/anthropic/claude-haiku-5.5",
    "omg/openai/gpt-6.1-sol",
    "omg/openai/gpt-6-astra",
    "omg/openai/gpt-6-luna",
  ].filter((model) => model !== OMG_DEFAULT_MODEL),
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
  // Callstack Apex direct gateway, text-only until vision support is verified.
  "omg/apex": TEXT,
  "omg/deepseek/deepseek-v4-flash-0731": TEXT,
  "omg/deepseek/deepseek-v4-pro": TEXT,
  "omg/z-ai/glm-5.3-flash": TEXT_IMAGE,
  "omg/z-ai/glm-5.3": TEXT,
  "omg/minimax/minimax-m3": TEXT_IMAGE,
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

export const OMG_THINKING_LEVELS_BY_MODEL: Record<string, readonly string[]> = Object.fromEntries(
  [
    "omg/deepseek/deepseek-v4-flash-0731",
    "omg/deepseek/deepseek-v4-pro",
    "omg/z-ai/glm-5.3-flash",
    "omg/z-ai/glm-5.3",
    "omg/x-ai/grok-4.7",
    "omg/anthropic/claude-fable-5.1",
    "omg/anthropic/claude-opus-5.5",
    "omg/anthropic/claude-sonnet-5.5",
    "omg/anthropic/claude-haiku-5.5",
    "omg/openai/gpt-6.1-sol",
    "omg/openai/gpt-6-astra",
    // reasoning_effort listed 2026-09-30.
    "omg/openai/gpt-6-luna",
  ].map((model) => [model, OMG_EFFORT_LEVELS]),
);

/** Levels for one hosted model, or null when the router has no control for it. */
export function omgThinkingLevels(model: string): readonly string[] | null {
  return OMG_THINKING_LEVELS_BY_MODEL[model] ?? null;
}
