import { resolveClaudePath } from "./agents/backends/claude-path.ts";
import { claudeMcpConfigFile } from "./private-mcp-config.ts";
import { omgMcpServers } from "./config.ts";

export interface BtwTranscriptMessage {
  role: string;
  kind: string;
  text: string;
  toolName?: string;
}

export interface BtwHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export interface BuildBtwPromptInput {
  sessionTitle?: string;
  agent?: string;
  cwd?: string;
  messages: BtwTranscriptMessage[];
  history?: BtwHistoryTurn[];
  question: string;
  maxContextChars?: number;
}

const DEFAULT_MAX_CONTEXT_CHARS = 48_000;

function formatTranscriptLine(msg: BtwTranscriptMessage): string | null {
  const text = msg.text.trim();
  if (!text) return null;
  if (msg.kind === "tool_use" || msg.kind === "tool_call") {
    const label = msg.toolName ? `tool(${msg.toolName})` : "tool";
    return `[${label}]: ${text.slice(0, 600)}`;
  }
  if (msg.kind === "tool_result") {
    return `[tool_result]: ${text.slice(0, 1200)}`;
  }
  const speaker = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : "System";
  return `${speaker}: ${text}`;
}

/**
 * Build a tool-free side-question prompt from the session's committed
 * transcript and any prior turns in the current `/btw` side thread.
 */
export function buildBtwPrompt(input: BuildBtwPromptInput): string {
  const maxChars = input.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const formatted: string[] = [];
  for (const msg of input.messages) {
    const line = formatTranscriptLine(msg);
    if (line) formatted.push(line);
  }

  // Keep the most recent lines within the character budget.
  const kept: string[] = [];
  let total = 0;
  for (let i = formatted.length - 1; i >= 0; i--) {
    const line = formatted[i];
    if (total + line.length + 1 > maxChars && kept.length > 0) break;
    kept.push(line);
    total += line.length + 1;
  }
  kept.reverse();

  const metaParts = [
    input.sessionTitle ? `Session: ${input.sessionTitle}` : null,
    input.agent ? `Agent: ${input.agent}` : null,
    input.cwd ? `Workspace: ${input.cwd}` : null,
  ].filter(Boolean);

  const sections: string[] = [
    [
      "You are answering an ephemeral /btw side question about an active coding session.",
      "Rules:",
      "- Answer ONLY from the session context below. You have NO tools and cannot inspect files or run commands.",
      "- If the answer is not in the context, state that clearly instead of guessing.",
      "- Keep the answer concise, direct, and technical.",
      "- This exchange is never saved to the main session history.",
    ].join("\n"),
  ];

  if (metaParts.length > 0) {
    sections.push(`## Session Metadata\n${metaParts.join("\n")}`);
  }

  sections.push(
    kept.length > 0
      ? `## Main Session Context\n${kept.join("\n\n")}`
      : "## Main Session Context\n(No prior messages in this session yet.)",
  );

  const history = (input.history ?? []).filter((turn) => turn.text.trim().length > 0);
  if (history.length > 0) {
    const historyLines = history.map((turn) =>
      `${turn.role === "user" ? "Side User" : "Side Assistant"}: ${turn.text.trim()}`,
    );
    sections.push(`## Prior /btw Turns\n${historyLines.join("\n\n")}`);
  }

  sections.push(`## Side Question\n${input.question.trim()}`);
  return sections.join("\n\n");
}

export interface StreamBtwOptions {
  prompt: string;
  model?: string;
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
}

/**
 * Stream a tool-free side-question answer using the installed Claude Agent SDK.
 */
export async function streamBtwAnswer(opts: StreamBtwOptions): Promise<string> {
  const model = opts.model ?? process.env.LFG_BTW_MODEL ?? process.env.LFG_CLAUDE_MODEL ?? "sonnet";
  const claudePath = resolveClaudePath();
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  using mcpConfig = claudeMcpConfigFile(
    process.env.OMG_SESSION_ID ?? process.env.LFG_SESSION_ID ?? "btw",
    omgMcpServers(),
  );

  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  if (opts.signal) {
    if (opts.signal.aborted) abortController.abort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const q = query({
      prompt: opts.prompt,
      options: {
        model,
        permissionMode: "bypassPermissions",
        allowedTools: [],
        tools: [],
        settingSources: ["user", "project"],
        ...mcpConfig.options,
        includePartialMessages: true,
        abortController,
        ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
      },
    });

    let accumulated = "";
    let resultText = "";

    for await (const raw of q) {
      if (opts.signal?.aborted) break;
      const msg = raw as Record<string, unknown>;
      if (msg.type === "stream_event") {
        const event = msg.event as Record<string, unknown> | undefined;
        if (event?.type === "content_block_delta") {
          const delta = event.delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
            accumulated += delta.text;
            opts.onDelta(delta.text);
          }
        }
      } else if (msg.type === "result" && typeof msg.result === "string") {
        resultText = msg.result;
      }
    }

    if (!accumulated && resultText) {
      opts.onDelta(resultText);
      return resultText;
    }
    return accumulated || resultText;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
