// Vercel AI SDK backend for report generation — an alternative to spawning
// `claude -p` directly (see pipeToClaudeCli in ../runner.ts).
//
// It uses the `ai-sdk-provider-claude-code` community provider, which drives
// the Claude Code CLI under the hood. We deliberately point it at the user's
// *installed* `claude` binary (pathToClaudeCodeExecutable) so it runs the exact
// same executable and the exact same subscription OAuth credentials
// (~/.claude/.credentials.json) as the legacy CLI path — no API key, no second
// runtime, no version drift. settingSources lets it honor ~/.claude/settings.json.
//
// Deps (ai, ai-sdk-provider-claude-code, zod, @anthropic-ai/sdk,
// @modelcontextprotocol/sdk) are only imported here, and this module is only
// imported when LFG_CLAUDE_BACKEND=ai-sdk, so the legacy CLI backend keeps
// working even if these packages aren't installed.

export type AiSdkOptions = {
  /** Model id: "opus" | "sonnet" | "haiku" or a full id like "claude-opus-4-8". */
  model?: string;
  /** Tools to allow (mirrors the CLI's --allowedTools). */
  allowedTools?: string[];
  /** Claude Code reasoning effort. */
  thinkingLevel?: string;
};

/** Resolve the installed `claude` binary so the provider drives it directly. */
function resolveClaudePath(): string | undefined {
  // Bun.which honors PATH; fall back to undefined so the provider uses its own.
  try {
    return Bun.which("claude") ?? undefined;
  } catch {
    return undefined;
  }
}

function effortFor(level?: string): string | undefined {
  if (!level) return undefined;
  if (level === "none" || level === "minimal") return "low";
  if (["low", "medium", "high", "xhigh", "max"].includes(level)) return level;
  return undefined;
}

export async function pipeToClaudeAiSdk(
  prompt: string,
  log: (s: string) => void,
  opts: AiSdkOptions = {},
): Promise<string> {
  const model = opts.model ?? process.env.LFG_CLAUDE_MODEL ?? "opus";
  const allowedTools = opts.allowedTools ?? ["WebSearch", "WebFetch"];
  const effort = effortFor(opts.thinkingLevel);
  const claudePath = process.env.LFG_CLAUDE_PATH ?? resolveClaudePath();

  log(`[runner] piping ${prompt.length} chars to claude via ai-sdk (${model})`);

  // Lazy import so the package is only required when this backend is selected.
  const { streamText } = await import("ai");
  const { claudeCode } = await import("ai-sdk-provider-claude-code");

  const llm = claudeCode(model, {
    // Same read-only web tools the CLI path grants for "other sources" lookups.
    // NB: this allow-list implicitly EXCLUDES AskUserQuestion, so this one-shot
    // report backend can never call it — which matters because bypass perms do
    // NOT auto-resolve AskUserQuestion and a headless caller can't answer it
    // (would hang). Do NOT add AskUserQuestion to this list.
    allowedTools,
    ...(effort ? { effort } : {}),
    // Honor the user's ~/.claude/settings.json + project settings, matching the
    // installed CLI's behavior.
    settingSources: ["user", "project"],
    // Drive the *installed* claude binary + its subscription auth, not a copy
    // bundled inside node_modules.
    ...(claudePath
      ? { sdkOptions: { pathToClaudeCodeExecutable: claudePath } }
      : {}),
  } as any);

  if (claudePath) log(`[runner] ai-sdk driving installed binary: ${claudePath}`);

  const result = streamText({ model: llm, prompt });

  let chars = 0;
  let lastEmit = 0;
  const flush = (force = false) => {
    const now = Date.now();
    if (force || now - lastEmit > 800) {
      lastEmit = now;
      const k = chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : String(chars);
      log(`[runner] generating report… ${k} chars`);
    }
  };

  // fullStream surfaces text deltas, tool calls, and errors — mirroring the
  // progress signal we get from the CLI's stream-json events.
  for await (const part of result.fullStream as any) {
    switch (part?.type) {
      case "text-delta": {
        const t = part.text ?? part.textDelta ?? part.delta ?? "";
        chars += String(t).length;
        flush();
        break;
      }
      case "tool-call":
        log(`[runner] claude running tool: ${part.toolName ?? "?"}`);
        break;
      case "error":
        throw new Error(
          `ai-sdk stream error: ${String((part as any).error).slice(0, 800)}`,
        );
    }
  }

  // Awaiting .text rejects if the underlying generation failed.
  const text = await result.text;
  flush(true);
  if (!text || !text.trim()) {
    throw new Error("ai-sdk backend produced empty result");
  }
  log(`[runner] ai-sdk done (${text.length} chars)`);
  return text;
}
