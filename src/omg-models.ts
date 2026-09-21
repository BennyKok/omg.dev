// The cheapest hosted model owns small internal tasks such as session titles.
// Keep this explicit: picker order is a UX choice, not a pricing contract.
export const OMG_CHEAPEST_MODEL = "omg/deepseek/deepseek-v4-flash-0731";

// Shared by the runtime and dashboard. Order is the hosted router picker order.
export const OMG_MODELS: string[] = [
  OMG_CHEAPEST_MODEL,
  "omg/deepseek/deepseek-v4-pro",
  "omg/z-ai/glm-5.3-flash",
  "omg/z-ai/glm-5.2",
  "omg/qwen/qwen3.7-plus",
  "omg/qwen/qwen3-coder-next",
  "omg/minimax/minimax-m3",
  "omg/x-ai/grok-4.7",
  "omg/anthropic/claude-fable-5.1",
  "omg/anthropic/claude-opus-4.8",
  "omg/anthropic/claude-sonnet-4.6",
  "omg/openai/gpt-5.6-sol",
  "omg/openai/gpt-5.6-terra",
  "omg/openai/gpt-5.6-luna",
];

/**
 * Thinking levels the hosted router honours per model.
 *
 * The omg agent runs through OpenCode's openai-compatible provider, and the
 * router forwards `/openai/v1/chat/completions` to OpenRouter with the body
 * unchanged (vibes apps/infra/internal/proxy/llm.go, the openrouter branch),
 * so a level reaches OpenRouter as `reasoning_effort`. The models below list
 * `reasoning_effort` in OpenRouter's `supported_parameters` (read on
 * 2026-09-20 from https://openrouter.ai/api/v1/models). qwen3.7-plus and
 * minimax-m3 take only the `reasoning` object and qwen3-coder-next has no
 * reasoning control, so they get no selector: a level that does nothing is
 * worse than none.
 */
const OMG_EFFORT_LEVELS = ["low", "medium", "high"] as const;

export const OMG_THINKING_LEVELS_BY_MODEL: Record<string, readonly string[]> = Object.fromEntries(
  [
    "omg/deepseek/deepseek-v4-flash-0731",
    "omg/deepseek/deepseek-v4-pro",
    "omg/z-ai/glm-5.3-flash",
    "omg/z-ai/glm-5.2",
    "omg/x-ai/grok-4.7",
    "omg/anthropic/claude-fable-5.1",
    "omg/anthropic/claude-opus-4.8",
    "omg/anthropic/claude-sonnet-4.6",
    "omg/openai/gpt-5.6-sol",
    "omg/openai/gpt-5.6-terra",
    "omg/openai/gpt-5.6-luna",
  ].map((model) => [model, OMG_EFFORT_LEVELS]),
);

/** Levels for one hosted model, or null when the router has no control for it. */
export function omgThinkingLevels(model: string): readonly string[] | null {
  return OMG_THINKING_LEVELS_BY_MODEL[model] ?? null;
}
