/** Shared, runtime-free Fast capability rules for server and native composer. */
export function codexModelSupportsFast(model: string | null | undefined): boolean {
  if (!model) return false;
  return model === "gpt-6-astra" || /^gpt-5\.(?:6(?:-|$)|5(?:-|$)|4$)/.test(model);
}

export function agentSupportsFastMode(agent: string): boolean {
  return ["codex", "codex-aisdk", "claude", "aisdk"].includes(agent);
}

export function supportsFastMode(agent: string, model?: string | null): boolean {
  return agentSupportsFastMode(agent) &&
    (agent === "claude" || agent === "aisdk" || codexModelSupportsFast(model));
}
