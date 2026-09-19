import { homedir } from "node:os";
import { join } from "node:path";
import { cloudApiBaseUrl, loadCloudCredentials, type FetchLike } from "./cloud-account.ts";
import { OMG_CHEAPEST_MODEL } from "./omg-models.ts";
import { stripOmgRuntimeContract } from "./omg-capabilities.ts";

export const SESSION_TITLE_MODEL = OMG_CHEAPEST_MODEL.replace(/^omg\//, "");
const TITLE_MAX = 72;
const PROMPT_MAX = 2_000;
/**
 * Big enough for a reasoning model to think before it answers.
 *
 * This was 24, which is generous for a 3-7 word title and useless for the
 * model that actually serves it. `OMG_CHEAPEST_MODEL` is a reasoning model:
 * measured against the live route on 2026-09-19, a title request spent 24 of
 * 24 tokens on reasoning and returned `content: null` with
 * `finish_reason: "length"`. So did 200. At 512 it answered in 391 tokens.
 *
 * Every automatic title was therefore empty, at both spawn time and on the
 * manual trigger, and the failure was invisible because the generator turns
 * any bad response into null.
 *
 * `reasoning: { effort: "none" }` is the cheaper fix and answered the same
 * prompt in 13 tokens, but it is a non-standard body field and this same
 * function also posts to the guest sandbox proxy, which was not available to
 * test against. A budget costs nothing when it is not spent, so raise the
 * ceiling rather than add a field that might be rejected.
 */
const TITLE_MAX_TOKENS = 512;

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
  const task = stripOmgRuntimeContract(prompt).replace(/\s+/g, " ").trim().slice(0, PROMPT_MAX);
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
        messages: [
          {
            role: "system",
            content: "Write a clear 3-7 word session title. Return only the title, with no quotes or punctuation.",
          },
          { role: "user", content: task },
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
