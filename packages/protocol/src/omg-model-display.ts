/**
 * Shared, runtime-free display rules for model ids: hosted
 * `omg/<provider>/<model>` ids, Claude CLI ids and Codex CLI ids.
 *
 * The router id is the wire format and stays the value everywhere. This file
 * owns how a picker SHOWS it: the provider it belongs to (for the mark) and a
 * short human name ("DeepSeek V4 Flash" for omg/deepseek/deepseek-v4-flash-0731).
 * The web composer and the native app import it by path so both surfaces
 * agree byte-for-byte without waiting for a package release.
 */

export type OmgModelInfo = {
  /** The router id, unchanged. */
  id: string;
  /** Provider slug from the id, lower case: deepseek, z-ai, qwen, minimax, anthropic, openai. */
  provider: string;
  providerLabel: string;
  /** Short human name of the model, without the provider path. */
  label: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: "DeepSeek",
  "z-ai": "Z.ai",
  qwen: "Qwen",
  minimax: "MiniMax",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  "x-ai": "xAI",
  meta: "Meta",
  mistral: "Mistral",
  moonshot: "Moonshot",
};

/** Tokens whose brand casing is not "first letter up". */
const TOKEN_CASE: Record<string, string> = {
  gpt: "GPT",
  glm: "GLM",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  xai: "xAI",
  llama: "Llama",
};

/** Tokens that glue to the following version with a hyphen: "GPT-5.6". */
const HYPHEN_BEFORE_VERSION = new Set(["gpt"]);

function caseToken(token: string): string {
  const lower = token.toLowerCase();
  if (TOKEN_CASE[lower]) return TOKEN_CASE[lower];
  // v4, m3, r2: a letter and digits reads as a version mark.
  if (/^[a-z]\d+(\.\d+)*$/.test(lower)) return lower.toUpperCase();
  if (/^\d/.test(lower)) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** "deepseek-v4-flash-0731" -> "DeepSeek V4 Flash". Exported for tests. */
export function humanizeOmgModelName(name: string): string {
  const tokens = name.split("-").filter(Boolean);
  // A trailing date stamp (0731, 20260731) is a snapshot tag, not a name.
  if (tokens.length > 1 && /^\d{4}(\d{4})?$/.test(tokens[tokens.length - 1]!)) tokens.pop();
  let out = "";
  tokens.forEach((token, index) => {
    const cased = caseToken(token);
    if (index === 0) {
      out = cased;
      return;
    }
    const previous = tokens[index - 1]!.toLowerCase();
    const glue = HYPHEN_BEFORE_VERSION.has(previous) && /^\d/.test(token) ? "-" : " ";
    out += glue + cased;
  });
  return out || name;
}

export function omgProviderLabel(provider: string): string {
  const key = provider.toLowerCase();
  return PROVIDER_LABELS[key] ?? caseToken(key);
}

/** Null for anything that is not a hosted `omg/<provider>/<model>` id. */
export function parseOmgModel(id: string | null | undefined): OmgModelInfo | null {
  if (!id) return null;
  const match = /^omg\/([^/]+)\/(.+)$/.exec(id.trim());
  if (!match) return null;
  const provider = match[1]!.toLowerCase();
  return {
    id: id.trim(),
    provider,
    providerLabel: omgProviderLabel(provider),
    label: humanizeOmgModelName(match[2]!),
  };
}

/**
 * Claude CLI ids and aliases: "claude-opus-5-5" -> "Opus 5.5", "opus" ->
 * "Opus". These only appear under a Claude agent, so the name drops "Claude".
 * Hosted omg ids keep it, because the omg agent mixes providers. Null for
 * anything else.
 */
export function claudeModelLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  const match = /^(?:claude-)?(opus|sonnet|haiku|fable)(?:-(\d+)(?:[-.](\d{1,2}))?)?(?:-\d{8})?$/.exec(id.trim().toLowerCase());
  if (!match) return null;
  const family = caseToken(match[1]!);
  const version = match[2] ? (match[3] ? `${match[2]}.${match[3]}` : match[2]) : "";
  return version ? `${family} ${version}` : family;
}

/**
 * Codex CLI ids: "gpt-6-astra" -> "GPT-6 Astra", "gpt-5.4-mini" -> "GPT-5.4
 * Mini". The same rule the hosted "GPT-5.6 Sol" uses. Null for anything else.
 */
export function codexModelLabel(id: string | null | undefined): string | null {
  if (!id || !/^gpt-\d/i.test(id.trim())) return null;
  return humanizeOmgModelName(id.trim());
}

/**
 * The one display name for a model id, for a picker row, pill, or badge.
 * The id stays the value everywhere; only the text shown changes. Ids with no
 * rule (codex, cursor, and other agents) pass through unchanged.
 */
export function omgModelLabel(id: string | null | undefined): string {
  return parseOmgModel(id)?.label ?? claudeModelLabel(id) ?? codexModelLabel(id) ?? (id ?? "");
}

/** Lower-case text a filter box should match: the id and the short name. */
export function omgModelSearchText(id: string): string {
  const info = parseOmgModel(id);
  if (info) return `${id} ${info.providerLabel} ${info.label}`.toLowerCase();
  const label = claudeModelLabel(id) ?? codexModelLabel(id);
  return (label ? `${id} ${label}` : id).toLowerCase();
}
