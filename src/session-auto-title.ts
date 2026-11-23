import { resolveClaudePath } from "./agents/backends/claude-path.ts";
import {
  customModelId,
  customModelStatus,
  loadCustomModels,
  type CustomModelStatus,
  type CustomProvider,
} from "./custom-models.ts";
import { stripOmgRuntimeContract } from "./omg-capabilities.ts";
import { redactSecrets } from "./redact-secrets.ts";
import { unwrapContinueSessionPrompt } from "./session-continue-prompt.ts";
import { getGlobalSettingsSync } from "./settings.ts";

/**
 * Automatic session titles from the models this box already has.
 *
 * omg.dev is local software, so there is no hosted title route any more. The
 * title comes from one of two places the owner set up himself:
 *
 *   - a custom OpenAI-compatible model from ~/.omg/models.json, called
 *     directly at its own baseURL with its own key;
 *   - the installed Claude CLI through the Agent SDK, on the owner's own
 *     Claude login, the same path `/btw` uses.
 *
 * Which one is `pickSessionTitleModel`'s decision, and it is a pure function
 * so the order is testable without a network or a CLI.
 */

/** The small Claude tier. A title is seven words; Opus would be waste. */
export const CLAUDE_TITLE_MODEL = "haiku";

const TITLE_MAX = 72;
const PROMPT_MAX = 2_000;
/**
 * Budget for a custom model's reply. Reasoning models (DeepSeek, Qwen3) spend
 * tokens on a think block before the title, and a 24-token budget returned
 * `content: null` with `finish_reason: "length"` on the old hosted route. A
 * budget costs nothing when it is not spent.
 */
const TITLE_MAX_TOKENS = 512;
const CUSTOM_TIMEOUT_MS = 20_000;
const CLAUDE_TIMEOUT_MS = 45_000;

/**
 * The task goes to the model as quoted data, not as the user turn itself.
 * Sent bare, the model treats the task as an instruction and does it: "Explain
 * this error..." came back as an invented error message. With this prompt and
 * the `<request>` wrapper, 35 of 35 runs over seven prompts returned a title
 * that named the request (hosted route, 2026-09-25).
 */
export const TITLE_SYSTEM_PROMPT = [
  "You name chat sessions for a task list.",
  "The user message holds a request that someone sent to an AI assistant, or a short digest of that conversation, inside <request> tags.",
  "Do not answer, perform, or continue the request, and do not invent details it does not contain.",
  "Reply with only a 3 to 7 word title that says what the request asks for, with no quotes or trailing punctuation.",
].join(" ");

/** A title the model produced by answering instead of naming runs long. */
const TITLE_MAX_WORDS = 12;

/**
 * Everything that must happen to text before it leaves this process. Both
 * callers (spawn-time prompt, menu-time digest) go through here, so redaction
 * cannot be forgotten by a caller.
 */
export function prepareTitleInput(raw: string): string {
  const unwrapped = unwrapContinueSessionPrompt(stripOmgRuntimeContract(raw));
  return redactSecrets(unwrapped).replace(/\s+/g, " ").trim().slice(0, PROMPT_MAX);
}

/** Turn a model reply into a safe, single-line card title. */
export function cleanGeneratedSessionTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*(?:title\s*:\s*)/i, "")
    .replace(/^\s*[`"'*]+|[`"'*]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!:;,-]+$/, "")
    .trim();
  if (!title) return null;
  if (title.split(" ").length > TITLE_MAX_WORDS) return null;
  return title.length <= TITLE_MAX ? title : `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

export type SessionTitleModel =
  | { kind: "custom"; id: string; baseURL: string; apiKey?: string; model: string }
  | { kind: "claude"; model: string };

export type PickSessionTitleModelInput = {
  /** The owner's choices, most explicit first: defaultModel, then lastModel. */
  selected: readonly string[];
  providers: readonly CustomProvider[];
  /** Probe result for custom models. Absent ids count as offline. */
  online: CustomModelStatus;
  claudeInstalled: boolean;
};

function customTarget(id: string, providers: readonly CustomProvider[]): SessionTitleModel | null {
  for (const provider of providers) {
    for (const model of provider.models) {
      if (customModelId(provider.id, model.id) !== id) continue;
      return {
        kind: "custom",
        id,
        baseURL: provider.baseURL,
        ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
        model: model.id,
      };
    }
  }
  return null;
}

/**
 * Which model writes the title.
 *
 * 1. A selected model that is a custom model and is online. The owner picked
 *    it, so it is the one he expects to be used and the one most likely warm.
 * 2. Claude haiku, when the Claude CLI is installed. It runs on the owner's
 *    own login and never wakes a scale-to-zero GPU host.
 * 3. The first online custom model, in file order.
 *
 * Null means the prompt-derived title stays. Offline custom models are never
 * picked: a title is not worth a 20 s timeout on every new session.
 */
export function pickSessionTitleModel(input: PickSessionTitleModelInput): SessionTitleModel | null {
  for (const id of input.selected) {
    const trimmed = id.trim();
    if (!trimmed || !input.online[trimmed]?.online) continue;
    const target = customTarget(trimmed, input.providers);
    if (target) return target;
  }
  if (input.claudeInstalled) return { kind: "claude", model: CLAUDE_TITLE_MODEL };
  for (const provider of input.providers) {
    for (const model of provider.models) {
      const id = customModelId(provider.id, model.id);
      if (input.online[id]?.online) return customTarget(id, input.providers);
    }
  }
  return null;
}

/** Read the box's settings, model file, probe and CLI, then pick. Never throws. */
export async function resolveSessionTitleModel(): Promise<SessionTitleModel | null> {
  try {
    const settings = getGlobalSettingsSync();
    const providers = loadCustomModels();
    const online = providers.length ? await customModelStatus() : {};
    return pickSessionTitleModel({
      selected: [settings.defaultModel, settings.lastModel],
      providers,
      online,
      claudeInstalled: !!resolveClaudePath(),
    });
  } catch {
    return null;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function titleFromCustom(
  target: Extract<SessionTitleModel, { kind: "custom" }>,
  task: string,
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<string | null> {
  const response = await fetcher(`${target.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: target.model,
      max_tokens: TITLE_MAX_TOKENS,
      temperature: 0.2,
      messages: [
        { role: "system", content: TITLE_SYSTEM_PROMPT },
        { role: "user", content: `<request>\n${task}\n</request>` },
      ],
    }),
    signal: signal ?? AbortSignal.timeout(CUSTOM_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const body = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  } | null;
  return cleanGeneratedSessionTitle(body?.choices?.[0]?.message?.content);
}

async function titleFromClaude(
  target: Extract<SessionTitleModel, { kind: "claude" }>,
  task: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const claudePath = resolveClaudePath();
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), CLAUDE_TIMEOUT_MS);
  const onAbort = () => abortController.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const q = query({
      prompt: `<request>\n${task}\n</request>`,
      options: {
        model: target.model,
        systemPrompt: TITLE_SYSTEM_PROMPT,
        // No tools, no MCP, no user or project settings: the call can only
        // write text, and no hook or CLAUDE.md rides along.
        tools: [],
        allowedTools: [],
        settingSources: [],
        maxTurns: 1,
        // Not written to ~/.claude/projects, so it never shows up as a
        // session of its own in the session list.
        persistSession: false,
        abortController,
        ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
      },
    });
    let result: string | null = null;
    for await (const raw of q) {
      const msg = raw as { type?: string; result?: unknown; is_error?: boolean };
      if (msg.type === "result") {
        result = !msg.is_error && typeof msg.result === "string" ? msg.result : null;
      }
    }
    return cleanGeneratedSessionTitle(result);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export type GenerateSessionTitleOptions = {
  /** Skip resolution. Tests pass a fixed target. */
  target?: SessionTitleModel | null;
  fetch?: FetchLike;
  signal?: AbortSignal;
  /** Test seam for the Claude path, so no test runs the real CLI. */
  claude?: (target: Extract<SessionTitleModel, { kind: "claude" }>, task: string) => Promise<string | null>;
};

/**
 * Best-effort title. No model, a timeout, an error reply, or a reply that
 * cleans down to nothing all return null, and the caller keeps the title it
 * already has.
 */
export async function generateSessionTitle(
  prompt: string | null | undefined,
  options: GenerateSessionTitleOptions = {},
): Promise<string | null> {
  if (!prompt) return null;
  const task = prepareTitleInput(prompt);
  if (!task) return null;
  const target = options.target !== undefined ? options.target : await resolveSessionTitleModel();
  if (!target) return null;
  try {
    if (target.kind === "custom") {
      return await titleFromCustom(target, task, options.fetch ?? globalThis.fetch, options.signal);
    }
    return await (options.claude ?? ((t, text) => titleFromClaude(t, text, options.signal)))(target, task);
  } catch {
    return null;
  }
}
