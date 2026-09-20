// The single owner of "strip credential-shaped strings out of text".
//
// Three callers need this and each one had been growing its own list:
// `omg doctor` (a report the user pastes into Discord), bot rotation (a
// handoff checkpoint copied into a new prompt), and automatic session titles
// (a few turns sent to a model). Two separate pattern lists already existed,
// and they did not agree: doctor knew about `tskey-`, `xai-`, `omg_sk_` and
// passwords inside URLs; rotation knew about Slack `xox…`, AWS `AKIA…` and
// Google `AIza…`. A secret leaked through whichever caller lacked its shape.
//
// So the patterns live here once and every caller gets the union.
//
// Pattern-based, not name-based, on purpose. An allowlist of known variable
// names ("ANTHROPIC_API_KEY", …) only protects against the secrets we already
// thought of; the token that leaks will be the one added next week under a
// name nobody updated here. These match the SHAPE of a secret, so a new
// provider's key is covered on the day it appears.
//
// This cannot catch a secret with no shape — a plain password written in a
// sentence reads exactly like prose. Callers that must not leak at all should
// also restrict WHAT they feed in (see `session-title-digest.ts`, which takes
// only user and assistant prose and never tool output).

/**
 * Ordered secret shapes and what replaces them.
 *
 * Order matters: the PEM block runs first because its base64 body would
 * otherwise be chewed up piecemeal by the later rules, leaving the `-----BEGIN`
 * marker behind and looking redacted when it is not.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Private keys in full, including the surrounding armour.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted-private-key]"],
  // Provider keys: sk-…, sk-ant-…, omg_sk_…, xai-…
  [/\b(sk-[A-Za-z0-9_-]{8,}|omg_sk_[A-Za-z0-9_-]{8,}|xai-[A-Za-z0-9_-]{8,})/g, "[redacted-key]"],
  // GitHub personal access tokens, in both the old and the fine-grained shape.
  [/\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/g, "[redacted-token]"],
  // Slack bot/user/app tokens.
  [/\bxox[baprse]-[A-Za-z0-9-]{10,}/g, "[redacted-token]"],
  // AWS access key ids and Google API keys.
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-key]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[redacted-key]"],
  // Tailscale auth keys.
  [/\btskey-[A-Za-z0-9-]{8,}/g, "[redacted-tailscale-key]"],
  // Credentials embedded in a URL (https://user:pass@host). These reach logs
  // through git remotes and proxy settings, and no key-name pattern sees them
  // because the secret is positional rather than named.
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1$2:[redacted]@"],
  // Bearer tokens, and anything assigned to a key/token/secret/password name.
  //
  // Both skip a value that is already a placeholder. Without that, this rule
  // runs after the shape rules above and rewrites their labelled output:
  // `deploy key:\n[redacted-private-key]` matches `key` + `:` + a long
  // non-space value, and the block that was correctly named a private key
  // degrades into a bare `[redacted]`.
  [/\b(bearer\s+)(?!\[redacted)[A-Za-z0-9._~+/-]{12,}=*/gi, "$1[redacted]"],
  [
    /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z0-9_]*)(\s*[=:]\s*)("?)(?!\[redacted)([^"\s,}]{6,})\3/gi,
    "$1$2$3[redacted]$3",
  ],
  // JWTs, which carry identity even when no name gives them away.
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted-jwt]"],
  // A long hex run is what an unrecognised secret looks like, and it is almost
  // never worth reading. A git SHA is 40 hex characters and does get caught;
  // that is an accepted cost, because the alternative is passing a raw key
  // through whenever it happens not to match a named shape above.
  [/\b[A-Fa-f0-9]{40,}\b/g, "[redacted-hash]"],
];

/** Replace every credential-shaped run in `text` with a labelled placeholder. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}
