import {
  codexModelSupportsFast,
  type CodexServiceTier,
} from "./service-tier.ts";

export type FastModeResolution =
  | { ok: true; enabled: boolean; serviceTier?: CodexServiceTier }
  | { ok: false; error: string };

export function agentSupportsFastMode(agent: string): boolean {
  return agent === "codex" ||
    agent === "codex-aisdk" ||
    agent === "claude" ||
    agent === "aisdk";
}

/**
 * Validate Fast independently from reasoning effort.
 *
 * `legacyServiceTier` keeps requests from the original Tibo-only UI working
 * while clients migrate to the provider-neutral `fastMode` flag.
 */
export function resolveSessionFastMode(input: {
  requested: unknown;
  legacyServiceTier?: unknown;
  agent: string;
  model?: string | null;
}): FastModeResolution {
  let enabled: boolean;
  if (input.requested == null || input.requested === "") {
    if (
      input.legacyServiceTier == null ||
      input.legacyServiceTier === "" ||
      input.legacyServiceTier === "default"
    ) {
      enabled = false;
    } else if (input.legacyServiceTier === "fast") {
      enabled = true;
    } else {
      return { ok: false, error: 'unknown service tier (expected "default" or "fast")' };
    }
  } else if (typeof input.requested === "boolean") {
    enabled = input.requested;
  } else {
    return { ok: false, error: "fastMode must be a boolean" };
  }

  if (!enabled) return { ok: true, enabled: false };
  if (!agentSupportsFastMode(input.agent)) {
    return { ok: false, error: `Fast mode is not supported for ${input.agent} sessions` };
  }
  if (
    (input.agent === "codex" || input.agent === "codex-aisdk") &&
    !codexModelSupportsFast(input.model)
  ) {
    return { ok: false, error: `Fast mode is not supported for model "${input.model ?? ""}"` };
  }
  return {
    ok: true,
    enabled: true,
    ...(input.agent === "codex" || input.agent === "codex-aisdk"
      ? { serviceTier: "fast" as const }
      : {}),
  };
}
