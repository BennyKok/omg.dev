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
  omg: "omg",
  callstack: "Callstack",
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
  // v4, m3, r2, e4b, a3b: a letter and digits reads as a version mark.
  if (/^[a-z]\d+(\.\d+)*[a-z]?$/.test(lower)) return lower.toUpperCase();
  // 8b, 70b, 1.5b: a parameter count reads in capitals.
  if (/^\d+(\.\d+)?[bkm]$/.test(lower)) return lower.toUpperCase();
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
  // Apex uses Callstack's unnamespaced gateway id on the wire.
  if (id.trim() === "omg/apex") return { id: id.trim(), provider: "callstack", providerLabel: omgProviderLabel("callstack"), label: "Apex" };
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
 * Names the server sends for models it alone knows, such as the owner's own
 * endpoints in ~/.omg/models.json. The client sets them when the model
 * catalog arrives; every label call below reads them first.
 */
let serverLabels: Record<string, string> = {};

export function setServerModelLabels(labels: Record<string, string> | null | undefined): void {
  serverLabels = { ...(labels ?? {}) };
}

/** Custom ids `custom-<provider>/<model>` -> "Gemma 4 E4B" for gemma-4-e4b. Null for anything else. */
export function customModelLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  const match = /^custom-[^/]+\/(.+)$/.exec(id.trim());
  if (!match) return null;
  // A served name like Qwen/Qwen3-8B keeps only its last part.
  return humanizeOmgModelName(match[1]!.split("/").pop()!);
}

/**
 * Lab namespaces as providers spell them, mapped to the slug used here. The
 * icon key strips punctuation, so `z-ai` and `zai` already meet; these are the
 * spellings that do not.
 */
const LAB_ALIASES: Record<string, string> = {
  "zai-org": "z-ai",
  zai: "z-ai",
  zhipuai: "z-ai",
  "x-ai": "xai",
  moonshotai: "moonshot",
  "meta-llama": "meta",
  mistralai: "mistral",
  "deepseek-ai": "deepseek",
  minimaxai: "minimax",
  "qwen-ai": "qwen",
};

/** Model-name prefixes that name their lab when the path does not. */
const LAB_BY_NAME: [RegExp, string][] = [
  [/^claude\b/, "anthropic"],
  [/^(gpt|o\d|codex|chatgpt)\b/, "openai"],
  [/^grok\b/, "xai"],
  [/^glm\b/, "z-ai"],
  [/^deepseek\b/, "deepseek"],
  [/^(qwen|qwq)/, "qwen"],
  [/^minimax\b/, "minimax"],
  [/^kimi\b/, "moonshot"],
  [/^(gemini|gemma)\b/, "google"],
  [/^llama\b/, "meta"],
  [/^(mistral|devstral|codestral|magistral)\b/, "mistral"],
];

/** Router names that are not labs: OpenCode providers and gateways. */
const ROUTE_LABELS: Record<string, string> = {
  omg: "omg.dev",
  opencode: "OpenCode Zen",
  "opencode-go": "OpenCode Go",
  openrouter: "OpenRouter",
  "novita-ai": "Novita AI",
  "github-copilot": "GitHub Copilot",
  "amazon-bedrock": "Amazon Bedrock",
  "google-vertex": "Google Vertex",
  groq: "Groq",
  together: "Together AI",
  togetherai: "Together AI",
  fireworks: "Fireworks",
  "fireworks-ai": "Fireworks",
  vercel: "Vercel",
  huggingface: "Hugging Face",
};

function labSlug(segment: string): string {
  const key = segment.toLowerCase();
  return LAB_ALIASES[key] ?? key;
}

export type RoutedModelInfo = {
  id: string;
  /** The router or provider the id goes through: "opencode-go", "novita-ai". */
  route: string;
  routeLabel: string;
  /** The lab that made the model, when the id says so. Null otherwise. */
  provider: string | null;
  providerLabel: string | null;
  /** Short human name of the model, without any path. */
  label: string;
};

/** Display name of a router, such as OpenCode Go or Novita AI. */
export function modelRouteLabel(route: string): string {
  const key = route.toLowerCase();
  if (ROUTE_LABELS[key]) return ROUTE_LABELS[key]!;
  if (PROVIDER_LABELS[labSlug(key)]) return PROVIDER_LABELS[labSlug(key)]!;
  const custom = /^custom-(.+)$/.exec(key);
  if (custom) return `Custom · ${custom[1]}`;
  return key.split("-").filter(Boolean).map(caseToken).join(" ") || route;
}

function routedModelName(name: string): string {
  const claude = claudeModelLabel(name);
  if (claude) return `Claude ${claude}`;
  return humanizeOmgModelName(name);
}

/**
 * Provider-routed ids that other agents use, such as OpenCode's
 * `opencode-go/glm-5.3`, `xai/grok-4.5` and `novita-ai/zai-org/glm-5`. The
 * first segment is the route. The lab comes from a known route name, then a
 * middle namespace, then the model name. Hosted `omg/<provider>/<model>` ids
 * read as the omg route with their lab. Null for an id with no slash.
 */
export function parseRoutedModel(id: string | null | undefined): RoutedModelInfo | null {
  if (!id) return null;
  const trimmed = id.trim();
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const route = parts[0]!.toLowerCase();
  const hosted = parseOmgModel(trimmed);
  if (hosted) {
    return {
      id: trimmed,
      route: "omg",
      routeLabel: modelRouteLabel("omg"),
      provider: hosted.provider,
      providerLabel: hosted.providerLabel,
      label: hosted.label,
    };
  }
  const name = parts[parts.length - 1]!;
  const custom = route.startsWith("custom-") ? customModelLabel(trimmed) : null;
  let provider: string | null = null;
  if (PROVIDER_LABELS[labSlug(route)]) provider = labSlug(route);
  else if (parts.length > 2 && PROVIDER_LABELS[labSlug(parts[1]!)]) provider = labSlug(parts[1]!);
  else {
    const lower = name.toLowerCase();
    provider = LAB_BY_NAME.find(([pattern]) => pattern.test(lower))?.[1] ?? null;
  }
  return {
    id: trimmed,
    route,
    routeLabel: modelRouteLabel(route),
    provider,
    providerLabel: provider ? omgProviderLabel(provider) : null,
    label: custom ?? routedModelName(name),
  };
}

/**
 * True when a model list goes through routers other than omg, as OpenCode's
 * does. Pickers group such a list by router (`routeLabel`) instead of by
 * credit use. The omg agent's own list (hosted ids plus the owner's
 * `custom-*` endpoints) is false.
 */
export function modelListHasRoutes(ids: readonly string[]): boolean {
  return ids.some((id) => {
    if (id.startsWith("custom-")) return false;
    const route = parseRoutedModel(id)?.route;
    return !!route && route !== "omg";
  });
}

/** The lab slug for a model's mark: hosted or routed id, else null. */
export function modelLabProvider(id: string | null | undefined): string | null {
  return parseOmgModel(id)?.provider ?? parseRoutedModel(id)?.provider ?? null;
}

/**
 * The one display name for a model id, for a picker row, pill, or badge.
 * The id stays the value everywhere; only the text shown changes. Ids with no
 * rule (codex, cursor, and other agents) pass through unchanged.
 */
export function omgModelLabel(id: string | null | undefined): string {
  if (id && serverLabels[id]) return serverLabels[id]!;
  return (
    parseOmgModel(id)?.label ??
    customModelLabel(id) ??
    claudeModelLabel(id) ??
    codexModelLabel(id) ??
    parseRoutedModel(id)?.label ??
    (id ?? "")
  );
}

/** Lower-case text a filter box should match: the id and the short name. */
export function omgModelSearchText(id: string): string {
  const info = parseOmgModel(id);
  if (info) return `${id} ${info.providerLabel} ${info.label}`.toLowerCase();
  const routed = serverLabels[id] ? null : parseRoutedModel(id);
  if (routed) {
    return [id, routed.routeLabel, routed.providerLabel, routed.label].filter(Boolean).join(" ").toLowerCase();
  }
  const label = serverLabels[id] ?? customModelLabel(id) ?? claudeModelLabel(id) ?? codexModelLabel(id);
  return (label ? `${id} ${label}` : id).toLowerCase();
}
