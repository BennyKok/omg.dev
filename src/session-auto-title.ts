import { homedir } from "node:os";
import { join } from "node:path";
import { cloudApiBaseUrl, loadCloudCredentials, type FetchLike } from "./cloud-account.ts";
import { OMG_CHEAPEST_MODEL } from "./omg-models.ts";
import { stripOmgRuntimeContract } from "./omg-capabilities.ts";
import { redactSecrets } from "./redact-secrets.ts";
import { unwrapContinueSessionPrompt } from "./session-continue-prompt.ts";

export const SESSION_TITLE_MODEL = OMG_CHEAPEST_MODEL.replace(/^omg\//, "");
const TITLE_MAX = 72;
const PROMPT_MAX = 2_000;
/**
 * `OMG_CHEAPEST_MODEL` is a reasoning model, and a title request must not let
 * it think.
 *
 * Measured against the live route on 2026-09-19 with the real prompt. At the
 * original `max_tokens: 24` it spent every token on reasoning and returned
 * `content: null` with `finish_reason: "length"`. At 512, three runs gave one
 * title, one `content: null`, and one paragraph that answered the task
 * instead of naming it. With `reasoning: { effort: "none" }` three runs each
 * returned the same 7-token title.
 *
 * So the request turns reasoning off. The 512 budget stays as a floor in case
 * a proxy drops the non-standard `reasoning` field: a budget costs nothing
 * when it is not spent, and the alternative is the silent empty title again.
 */
const TITLE_MAX_TOKENS = 512;
const TITLE_REASONING = { effort: "none" } as const;

/**
 * The task goes to the model as quoted data, not as the user turn itself.
 *
 * Sent bare, the model treats the task as an instruction and does it. Measured
 * on the live route on 2026-09-25 with the mobile onboarding tasks: "Explain
 * this error..." came back as an invented error message ("Cannot read
 * properties of undefined (reading 'map')"), and "Review this pull
 * request..." came back as a list of made-up findings. Real sessions were
 * saved as "Unexpected token in JSON at position 0" and "Session title must
 * be 3-7 words". With this prompt and the `<request>` wrapper, 35 of 35 runs
 * over seven prompts returned a title that named the request.
 */
const TITLE_SYSTEM_PROMPT = [
  "You name chat sessions for a task list.",
  "The user message holds a request that someone sent to an AI assistant, or a short digest of that conversation, inside <request> tags.",
  "Do not answer, perform, or continue the request, and do not invent details it does not contain.",
  "Reply with only a 3 to 7 word title that says what the request asks for, with no quotes or trailing punctuation.",
].join(" ");
/**
 * A title the model produced by answering instead of naming runs long. The
 * card truncates at `TITLE_MAX` characters, so without this a paragraph is
 * saved as its first 72 characters and looks like a real title.
 */
const TITLE_MAX_WORDS = 12;

/**
 * Everything that must happen to text before it is sent to the title model.
 *
 * Both callers go through here, which is the point. The spawn-time path gets
 * the raw launch prompt and the manual path gets an assembled digest, and both
 * can carry a runtime contract, a continue envelope, or a credential. Doing
 * this in one place means a caller cannot forget a step; in particular
 * redaction is not optional and is not left to the caller.
 *
 * `buildSessionTitleDigest` already applies the same three steps per turn.
 * They are idempotent, so running them again on the assembled string costs a
 * few string operations and removes the question of which layer is
 * responsible.
 */
function prepareTitleInput(raw: string): string {
  const unwrapped = unwrapContinueSessionPrompt(stripOmgRuntimeContract(raw));
  return redactSecrets(unwrapped).replace(/\s+/g, " ").trim().slice(0, PROMPT_MAX);
}

type AutoTitleOptions = {
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  credentialPath?: string;
  cloudBaseUrl?: string;
  signal?: AbortSignal;
};

function titleEndpoint(options: AutoTitleOptions): { url: string; token?: string } | null {
  const env = options.env ?? process.env;
  const guestBase = env.OMG_AI_URL?.trim().replace(/\/+$/, "");
  if (guestBase) {
    return { url: `${guestBase.replace(/\/openai\/v1$/, "")}/openai/v1/chat/completions` };
  }
  const credentials = loadCloudCredentials(
    options.credentialPath ?? join(homedir(), ".omg", "credentials.json"),
  );
  if (!credentials) return null;
  const base = (options.cloudBaseUrl ?? cloudApiBaseUrl()).replace(/\/+$/, "");
  return {
    url: `${base}/api/cli/llm/v1/chat/completions`,
    token: credentials.token,
  };
}

/** Turn an OpenAI-compatible response into a safe, single-line card title. */
export function cleanGeneratedSessionTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*(?:title\s*:\s*)/i, "")
    .replace(/^\s*[`"']+|[`"']+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!:;,-]+$/, "")
    .trim();
  if (!title) return null;
  if (title.split(" ").length > TITLE_MAX_WORDS) return null;
  return title.length <= TITLE_MAX ? title : `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

/**
 * Best-effort title generation through the omg.dev managed AI route.
 * A missing account, timeout, rejected plan, or malformed response returns null.
 */
export async function generateSessionTitle(
  prompt: string | null | undefined,
  options: AutoTitleOptions = {},
): Promise<string | null> {
  if (!prompt) return null;
  const task = prepareTitleInput(prompt);
  if (!task) return null;
  const endpoint = titleEndpoint(options);
  if (!endpoint) return null;
  try {
    const response = await (options.fetch ?? globalThis.fetch)(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(endpoint.token ? { Authorization: `Bearer ${endpoint.token}` } : {}),
      },
      body: JSON.stringify({
        model: SESSION_TITLE_MODEL,
        max_tokens: TITLE_MAX_TOKENS,
        temperature: 0.2,
        reasoning: TITLE_REASONING,
        messages: [
          { role: "system", content: TITLE_SYSTEM_PROMPT },
          { role: "user", content: `<request>\n${task}\n</request>` },
        ],
      }),
      signal: options.signal ?? AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    } | null;
    return cleanGeneratedSessionTitle(body?.choices?.[0]?.message?.content);
  } catch {
    return null;
  }
}
