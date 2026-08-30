export type CodexServiceTier = "fast";

export type CodexConfigValue =
  | string
  | number
  | boolean
  | CodexConfigValue[]
  | { [key: string]: CodexConfigValue };

export type ServiceTierResolution =
  | { ok: true; serviceTier?: CodexServiceTier }
  | { ok: false; error: string };

/** Codex currently advertises Fast tier for GPT-5.4, GPT-5.5 and GPT-5.6. */
export function codexModelSupportsFast(model: string | null | undefined): boolean {
  if (!model) return false;
  return /^gpt-5\.(?:6(?:-|$)|5(?:-|$)|4$)/.test(model);
}

/** Validate the untrusted service-tier field from a new-session request. */
export function resolveSessionServiceTier(input: {
  requested: unknown;
  agent: string;
  model?: string | null;
}): ServiceTierResolution {
  if (input.requested == null || input.requested === "" || input.requested === "default") {
    return { ok: true };
  }
  if (input.requested !== "fast") {
    return { ok: false, error: 'unknown service tier (expected "default" or "fast")' };
  }
  if (input.agent !== "codex-aisdk" && input.agent !== "codex") {
    return { ok: false, error: `Fast service tier is not supported for ${input.agent} sessions` };
  }
  if (!codexModelSupportsFast(input.model)) {
    return { ok: false, error: `Fast service tier is not supported for model "${input.model ?? ""}"` };
  }
  return { ok: true, serviceTier: "fast" };
}

export function codexServiceTierArgs(serviceTier?: CodexServiceTier): string[] {
  return serviceTier === "fast"
    ? ["-c", 'service_tier="fast"', "-c", "features.fast_mode=true"]
    : [];
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
