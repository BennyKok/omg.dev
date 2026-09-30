/** Shared, runtime-free Fast capability rules for server and native composer. */
export function codexModelSupportsFast(model: string | null | undefined): boolean {
  if (!model) return false;
  // Codex advertises Fast for GPT-6 (including 6.1), GPT-5.6, GPT-5.5, and exact GPT-5.4.
  return /^(?:gpt-6(?:\.\d+)?(?:-|$)|gpt-5\.(?:6(?:-|$)|5(?:-|$)|4$))/.test(model);
}

export function agentSupportsFastMode(agent: string): boolean {
  return ["codex", "codex-aisdk", "claude", "aisdk"].includes(agent);
}

export function supportsFastMode(agent: string, model?: string | null): boolean {
  return agentSupportsFastMode(agent) &&
    (agent === "claude" || agent === "aisdk" || codexModelSupportsFast(model));
}
