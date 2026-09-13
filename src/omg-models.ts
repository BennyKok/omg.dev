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
  "omg/anthropic/claude-fable-5.1",
  "omg/anthropic/claude-opus-4.8",
  "omg/anthropic/claude-sonnet-4.6",
  "omg/openai/gpt-5.6-sol",
  "omg/openai/gpt-5.6-terra",
  "omg/openai/gpt-5.6-luna",
];
