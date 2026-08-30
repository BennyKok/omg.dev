export type FastChatCommand =
  | { matched: false }
  | { matched: true; enabled?: boolean; error?: string };

export function fastModeStorageKey(agent: string): string {
  const provider = agent === "codex" || agent === "codex-aisdk"
    ? "codex"
    : agent === "claude" || agent === "aisdk"
      ? "claude"
      : agent;
  return `omg_fast_mode_${provider}`;
}

export function readFastMode(
  storage: { getItem(key: string): string | null },
  agent: string,
): boolean {
  return storage.getItem(fastModeStorageKey(agent)) === "on";
}

export function writeFastMode(
  storage: { setItem(key: string, value: string): void },
  agent: string,
  enabled: boolean,
): void {
  storage.setItem(fastModeStorageKey(agent), enabled ? "on" : "off");
}

export function composerSupportsFastMode(input: {
  agent: string;
  model?: string | null;
}): boolean {
  if (input.agent === "claude" || input.agent === "aisdk") return true;
  if (input.agent !== "codex" && input.agent !== "codex-aisdk") return false;
  return !!input.model && /^gpt-5\.(?:6(?:-|$)|5(?:-|$)|4$)/.test(input.model);
}

/** Parse only the complete control command, never arbitrary prompt text. */
export function parseFastChatCommand(text: string): FastChatCommand {
  const trimmed = text.trim();
  if (!/^\/fast(?:\s|$)/i.test(trimmed)) return { matched: false };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { matched: true };
  if (parts.length === 2 && /^on$/i.test(parts[1])) {
    return { matched: true, enabled: true };
  }
  if (parts.length === 2 && /^off$/i.test(parts[1])) {
    return { matched: true, enabled: false };
  }
  return {
    matched: true,
    error: 'Use "/fast", "/fast on", or "/fast off".',
  };
}
