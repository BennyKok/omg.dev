export type CodexServiceTier = "fast";

export type CodexConfigValue =
  | string
  | number
  | boolean
  | CodexConfigValue[]
  | { [key: string]: CodexConfigValue };

/** Codex currently advertises Fast tier for GPT-5.4, GPT-5.5 and GPT-5.6. */
export function codexModelSupportsFast(model: string | null | undefined): boolean {
  if (!model) return false;
  return /^gpt-5\.(?:6(?:-|$)|5(?:-|$)|4$)/.test(model);
}

/** Merge Fast tier into SDK config without discarding per-session MCP config. */
export function withCodexServiceTierConfig(
  base: { [key: string]: CodexConfigValue } | undefined,
  serviceTier?: CodexServiceTier,
): { [key: string]: CodexConfigValue } | undefined {
  if (serviceTier !== "fast") return base;
  const features = base?.features;
  const featureObject = features && !Array.isArray(features) && typeof features === "object"
    ? features
    : {};
  return {
    ...(base ?? {}),
    service_tier: "fast",
    features: { ...featureObject, fast_mode: true },
  };
}
