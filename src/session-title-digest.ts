// What an automatic title is allowed to read.
//
// The first version sent exactly one thing: the first user message. That is
// what Claude Code, Cursor, ChatGPT and OpenCode all do, and for a session
// that opens with a clear request it is enough. It breaks on two shapes this
// product produces constantly:
//
//   - a CONTINUED session, whose first user message is the continue envelope,
//     so every such session got a title about reviewing a transcript;
//   - a session that opened vaguely ("have a look at this") and only became
//     about something three turns later.
//
// So the title reads a small digest instead: the opening request, the latest
// request, and the latest answer. Three turns, hard-clamped, is enough to name
// a session and small enough that nobody has to think about the cost. It is
// NOT a summary of the session and must not grow into one — no transcript
// walk, no token counting, no second model call.
//
// Two rules keep it safe to send:
//
//   1. Only `role in (user, assistant)` and `kind = 'text'` are eligible. Tool
//      calls and tool results never enter. That is where secrets actually live
//      in an agent transcript: a printed .env, a curl with a header, a cloud
//      CLI dumping credentials. Excluding them removes most of the exposure
//      before any pattern matching happens.
//   2. What survives that is still run through `redactSecrets`, BEFORE the
//      clamp, so a key cut in half by truncation cannot slip past its pattern.

import { redactSecrets } from "./redact-secrets.ts";
import { stripOmgRuntimeContract } from "./omg-capabilities.ts";
import { unwrapContinueSessionPrompt } from "./session-continue-prompt.ts";

/** Per-part budgets. The assembled digest cannot exceed their sum. */
export const DIGEST_FIRST_USER_MAX = 600;
export const DIGEST_LAST_USER_MAX = 400;
export const DIGEST_LAST_ASSISTANT_MAX = 600;

export type SessionTitleDigestParts = {
  /** Opening request, with any launch envelope already unwrapped by us. */
  firstUser?: string | null;
  /** Most recent request, when it is not the opening one. */
  lastUser?: string | null;
  /** Most recent assistant prose. */
  lastAssistant?: string | null;
};

/**
 * Normalise one turn: strip envelopes, redact, collapse whitespace, clamp.
 *
 * Redaction runs before the clamp on purpose. Clamping first can cut a token
 * in half, and half a token matches no pattern, so the tail of a real key
 * would travel as innocent-looking text.
 */
function prepareTurn(raw: string | null | undefined, max: number): string {
  if (!raw) return "";
  const unwrapped = unwrapContinueSessionPrompt(stripOmgRuntimeContract(raw));
  const clean = redactSecrets(unwrapped).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Assemble the text a title is generated from.
 *
 * Returns an empty string when there is nothing titleable, which the caller
 * must treat as "do not call the model" rather than as a prompt.
 */
export function buildSessionTitleDigest(parts: SessionTitleDigestParts): string {
  const firstUser = prepareTurn(parts.firstUser, DIGEST_FIRST_USER_MAX);
  const lastUser = prepareTurn(parts.lastUser, DIGEST_LAST_USER_MAX);
  const lastAssistant = prepareTurn(parts.lastAssistant, DIGEST_LAST_ASSISTANT_MAX);

  const lines: string[] = [];
  if (firstUser) lines.push(`First request: ${firstUser}`);
  // Only worth spending budget on when the session has actually moved on. An
  // identical repeat teaches the model nothing and doubles the payload.
  if (lastUser && lastUser !== firstUser) lines.push(`Latest request: ${lastUser}`);
  if (lastAssistant) lines.push(`Latest answer: ${lastAssistant}`);
  return lines.join("\n");
}
