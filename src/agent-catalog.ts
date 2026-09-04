import type { Agent } from "./agents/registry.ts";
import type { AutoAgent } from "./auto/store.ts";
import type { CodingAgentInfo, CodingAgentKind } from "./coding-agents.ts";
import { readModelDiscoveryCacheSync } from "./model-discovery.ts";
import { PI_AUTH_PROVIDER_IDS } from "./pi-auth.ts";
import type { Session } from "./sessions.ts";

export type SkillCatalogItem = {
  name: string;
  trigger: string;
  description: string;
  /**
   * Up to 4000 characters of the skill's body, used to match a query against
   * the prose and not just the name. OPTIONAL because it stays server-side:
   * the index holds it, /api/skills strips it, and full-text matching happens
   * in searchSkillCatalog(). Shipping it was 354 KB of the catalog's 414 KB —
   * 102 KB of the 117 KB that crossed the wire even after compression — so
   * that one `.includes()` could run in the browser.
   */
  keywords?: string;
  source: "codex" | "claude" | "agent";
  path: string;
};

// `fable` is an alias the claude CLI resolves to the current Fable release
// (Fable 5 today). `claude-fable-5-1` is pinned on purpose: the CLI accepts the
// full id and serves it first-party, but no short alias points at 5.1 yet, so
// without this entry the picker cannot reach it.
export const CLAUDE_MODELS: string[] = ["fable", "claude-fable-5-1", "opus", "sonnet", "haiku"];
export const CODEX_MODELS: string[] = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex-spark",
];
// The Agent SDK takes the same model strings as the CLI, aliases or full ids
// (see claude-ai-sdk.ts, which passes this straight to query({ model })), so
// `claude-fable-5-1` is carried here for the same reason as CLAUDE_MODELS.
export const AISDK_MODELS: string[] = ["fable", "claude-fable-5-1", "opus", "sonnet", "haiku"];
export const CODEX_AISDK_MODELS: string[] = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex-spark",
];
export const GROK_MODELS: string[] = ["grok-4.6", "grok-4.5", "grok-composer-2.5-fast"];
export const CURSOR_MODELS: string[] = [
  "auto",
  "composer-2.5",
  "gpt-5",
  "gpt-5.5",
  "claude-opus-4.8",
  "gemini-3.1-pro",
  "cursor-grok-4.6",
];
// fx routes every model through Vercel AI Gateway, so its ids are the
// gateway's `provider/model` strings, not a private vocabulary. The list is a
// curated slice of `session/new` -> configOptions.model; "auto" keeps whatever
// model the user configured in ~/.fx/settings.json.
export const FX_MODELS: string[] = [
  "auto",
  "anthropic/claude-opus-5",
  "anthropic/claude-sonnet-5",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.5",
  "xai/grok-4.6",
  "moonshotai/kimi-k3",
  "zai/glm-5.2",
];
export const DEEPSEEK_MODELS: string[] = ["deepseek-v4-flash", "deepseek-v4-pro"];
// Static fallback until model discovery (GET api.meta.ai/muse-code/models, the
// document the CLI itself reads) has answered; discovery is authoritative and
// is how a newly released muse-spark shows up. The server-side default is the
// `-contributor` twin ("content may be used for product improvement"), so
// neither that twin nor "auto" (= that server default) is ever offered; omg
// always names the plain model. The default is whatever discovery lists
// first (newest release), see defaultModelForCatalogItem.
export const MUSE_MODELS: string[] = ["muse-spark-1.2"];
export const HERMES_MODELS: string[] = [
  "nousresearch/hermes-4-405b",
  "nousresearch/hermes-4-70b",
  "nousresearch/hermes-3-llama-3.1-405b",
];
// pi resolves the Claude aliases the same way the claude CLI does (fuzzy/glob
// match against its own Anthropic model catalog via the proxy), so reuse the
// same alias set as claude/aisdk rather than pi's raw model ids. deepseek is
// the one model the free plan is entitled to (no Claude model clears its
// minPlan) — pi-session.ts merges it into pi's Anthropic provider config as a
// custom model id so it resolves like the aliases above instead of erroring.
//
// Models from pi's other providers carry a `<providerId>/` prefix that
// pi-session.ts strips back into `--provider`/`--model`. They are only offered
// once that provider is signed in — see accessibleModelsForAgent below — so an
// unconnected user still sees exactly the Anthropic list pi has always had.
export const PI_CODEX_MODELS: string[] = [
  "openai-codex/gpt-5.6-sol",
  "openai-codex/gpt-5.6-terra",
  "openai-codex/gpt-5.6-luna",
  "openai-codex/gpt-5.5",
  "openai-codex/gpt-5.4",
];
export const PI_OPENCODE_MODELS: string[] = [
  "opencode/claude-opus-4-8",
  "opencode/claude-sonnet-5",
  "opencode/gpt-5.6-sol",
  "opencode/kimi-k2.7-code",
  "opencode/minimax-m3",
  "opencode/deepseek-v4-flash-free",
];
export const PI_MODELS: string[] = [
  "fable",
  "opus",
  "sonnet",
  "haiku",
  "deepseek/deepseek-v4-flash",
  ...PI_CODEX_MODELS,
  ...PI_OPENCODE_MODELS,
];
// Live `opencode models` discovery is authoritative and owns this list once the
// catalog cache exists. Until then — a first boot, an offline box, or a failed
// discovery run — the picker renders this fallback verbatim, and an anonymous
// account is filtered down to the `-free` entries. A single-entry fallback
// therefore looked like "OpenCode only offers one free model" to every brand
// new user who opened the picker inside the first refresh window, so seed it
// with the full credential-free Zen set instead of one representative id.
export const OPENCODE_MODELS: string[] = [
  "opencode/deepseek-v4-flash-free",
  "opencode/laguna-s-2.1-free",
  "opencode/ling-3.0-tiny-free",
  "opencode/longcat-2.0-free",
  "opencode/mimo-v2.5-free",
  "opencode/nemotron-3-ultra-free",
  "opencode/north-mini-code-free",
];
export const JCODE_MODELS: string[] = ["auto"];
export const COPILOT_MODELS: string[] = [
  "claude-sonnet-4.5",
  "claude-sonnet-4",
  "gpt-5",
];

export const AUTO_AGENT_BACKENDS = [
  "aisdk",
  "codex-aisdk",
  "grok",
  "cursor",
  "fx",
  "muse",
  "opencode",
] as const;
export type AutoAgentBackend = (typeof AUTO_AGENT_BACKENDS)[number];
const MODEL_CATALOG_KEYS: CodingAgentKind[] = [
  "claude",
  "aisdk",
  "codex",
  "codex-aisdk",
  "grok",
  "cursor",
  "fx",
  "muse",
  "deepseek",
  "opencode",
  "jcode",
  "pi",
  "copilot",
];

export const CODEX_THINKING_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const;
export const CLAUDE_THINKING_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
/**
 * What grok's CLI accepts. It rejects anything else outright —
 *
 *   --effort/--reasoning-effort: unknown effort level 'xhigh'; use one of: high, medium, low
 *
 * — and that is a hard exit, so offering a level grok can't take stops the
 * session launching at all rather than just being ignored. Verified against
 * grok 0.2.114.
 */
export const GROK_THINKING_LEVELS = ["low", "medium", "high"] as const;
/**
 * What pi's CLI lists in `pi --help`. pi differs from grok twice over: it warns
 * and carries on at its own default rather than exiting, so a mismatch is a
 * setting that silently never applies; and it has a real "off" and "minimal"
 * that the Claude vocabulary has to collapse.
 */
export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
// Jcode exposes the same /effort vocabulary as Claude. The managed REPL uses
// that command both before the first prompt and for live session changes.
export const JCODE_THINKING_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
// Muse's reasoningEffort vocabulary, changeable live per turn over MSP.
export const MUSE_THINKING_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "ultra"] as const;
export type ModelCatalogItem = {
  key: CodingAgentKind;
  label: string;
  defaultModel: string;
  models: string[];
  thinkingLevels: string[];
  /** Model-specific levels for providers whose variants differ per model. */
  thinkingLevelsByModel?: Record<string, string[]>;
  session: boolean;
  auto: boolean;
  visible?: boolean;
  configured?: boolean;
};

const LABELS: Record<CodingAgentKind, string> = {
  claude: "claude",
  aisdk: "claude",
  codex: "codex",
  "codex-aisdk": "codex",
  opencode: "opencode",
  jcode: "jcode",
  grok: "grok",
  cursor: "cursor",
  fx: "fx",
  muse: "muse",
  deepseek: "deepseek",
  hermes: "hermes",
  pi: "pi",
  copilot: "copilot",
};

export const MODEL_OPTIONS: Record<CodingAgentKind, { defaultModel: string; models: readonly string[] }> = {
  claude: { defaultModel: "sonnet", models: CLAUDE_MODELS },
  aisdk: { defaultModel: "opus", models: AISDK_MODELS },
  codex: { defaultModel: "gpt-5.6-sol", models: CODEX_MODELS },
  "codex-aisdk": { defaultModel: "gpt-5.6-sol", models: CODEX_AISDK_MODELS },
  grok: { defaultModel: "grok-4.6", models: GROK_MODELS },
  cursor: { defaultModel: "auto", models: CURSOR_MODELS },
  fx: { defaultModel: "auto", models: FX_MODELS },
  muse: { defaultModel: "muse-spark-1.2", models: MUSE_MODELS },
  deepseek: { defaultModel: "deepseek-v4-flash", models: DEEPSEEK_MODELS },
  hermes: { defaultModel: "nousresearch/hermes-4-405b", models: HERMES_MODELS },
  opencode: { defaultModel: "opencode/deepseek-v4-flash-free", models: OPENCODE_MODELS },
  jcode: { defaultModel: "auto", models: JCODE_MODELS },
  pi: { defaultModel: "sonnet", models: PI_MODELS },
  copilot: { defaultModel: "claude-sonnet-4.5", models: COPILOT_MODELS },
};

function mergeModels(...sets: Array<readonly string[] | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const set of sets) {
    for (const model of set ?? []) {
      if (!model || seen.has(model)) continue;
      seen.add(model);
      out.push(model);
    }
  }
  return out;
}

export function discoveredModelsOrFallback(
  fallback: readonly string[] | undefined,
  provider?: { ok: boolean; models: readonly string[] },
): string[] {
  return mergeModels(provider?.ok && provider.models.length ? provider.models : fallback);
}

const CURSOR_THINKING_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
const CURSOR_LEVEL_ALIASES: Record<string, string> = {
  "extra-high": "xhigh",
  xhigh: "xhigh",
  max: "max",
  high: "high",
  medium: "medium",
  low: "low",
  minimal: "minimal",
  none: "none",
};

type CursorVariant = {
  raw: string;
  base: string;
  level?: string;
  fast: boolean;
};

function parseCursorVariant(raw: string): CursorVariant {
  let base = raw;
  let fast = false;
  let level: string | undefined;

  const stripFast = () => {
    if (base.endsWith("-fast")) {
      base = base.slice(0, -"-fast".length);
      fast = true;
    }
  };
  const stripLevel = () => {
    const thinkingFirst = base.match(/-thinking-(none|minimal|low|medium|high|xhigh|max)$/);
    if (thinkingFirst) {
      level = CURSOR_LEVEL_ALIASES[thinkingFirst[1]];
      base = base.slice(0, -thinkingFirst[0].length);
      return true;
    }
    const thinkingLast = base.match(/-(none|minimal|low|medium|high|xhigh|max)-thinking$/);
    if (thinkingLast) {
      level = CURSOR_LEVEL_ALIASES[thinkingLast[1]];
      base = base.slice(0, -thinkingLast[0].length);
      return true;
    }
    const extraHigh = base.match(/-extra-high$/);
    if (extraHigh) {
      level = "xhigh";
      base = base.slice(0, -extraHigh[0].length);
      return true;
    }
    const plain = base.match(/-(none|minimal|low|medium|high|xhigh|max)$/);
    if (plain) {
      level = CURSOR_LEVEL_ALIASES[plain[1]];
      base = base.slice(0, -plain[0].length);
      return true;
    }
    return false;
  };

  stripFast();
  stripLevel();
  stripFast();
  base = base.replace(/^claude-opus-(\d+)\.(\d+)$/, "claude-opus-$1-$2");
  return { raw, base, level, fast };
}

function numberParts(value: string): number[] {
  return (value.match(/\d+(?:\.\d+)*/g) ?? [])
    .flatMap((part) => part.split(".").map((item) => parseInt(item, 10)))
    .filter((item) => Number.isFinite(item));
}

function compareModelVersion(a: string, b: string): number {
  const av = numberParts(a);
  const bv = numberParts(b);
  const n = Math.max(av.length, bv.length);
  for (let i = 0; i < n; i++) {
    const diff = (av[i] ?? -1) - (bv[i] ?? -1);
    if (diff) return diff;
  }
  return a.localeCompare(b);
}

function latest(items: string[]): string | undefined {
  return [...new Set(items)].sort((a, b) => compareModelVersion(b, a))[0];
}

function addLatest(out: string[], candidates: string[]) {
  const picked = latest(candidates);
  if (picked && !out.includes(picked)) out.push(picked);
}

export function curateCursorModels(models: string[]): string[] {
  const variants = models.map(parseCursorVariant);
  const bases = [...new Set(variants.map((item) => item.base))];
  const out: string[] = [];
  const add = (model: string | undefined) => {
    if (model && bases.includes(model) && !out.includes(model)) out.push(model);
  };

  add("auto");
  addLatest(out, bases.filter((m) => /^gpt-\d/.test(m) && !m.includes("codex") && !/-(mini|nano)$/.test(m)));
  addLatest(out, bases.filter((m) => /^gpt-\d/.test(m) && m.includes("codex") && !m.includes("mini")));
  addLatest(out, bases.filter((m) => /^gpt-\d/.test(m) && m.includes("mini")));
  // Cursor prefixes its own Grok builds (`cursor-grok-4.6-high-fast`), so an
  // anchored /^grok-/ silently dropped every Grok model from the picker when
  // Cursor renamed them — discovery kept returning 14 variants and curation
  // threw them all away. Match both spellings.
  addLatest(out, bases.filter((m) => /^(?:cursor-)?grok-\d/.test(m)));
  addLatest(out, bases.filter((m) => /^claude-fable/.test(m)));
  addLatest(out, bases.filter((m) => /claude.*sonnet/.test(m)));
  addLatest(out, bases.filter((m) => /claude.*opus/.test(m)));
  addLatest(out, bases.filter((m) => /^gemini-.*pro/.test(m)));
  addLatest(out, bases.filter((m) => /^kimi-.*code/.test(m) || /^kimi-k/.test(m)));
  addLatest(out, bases.filter((m) => /^glm-\d/.test(m)));
  addLatest(out, bases.filter((m) => /^composer-\d/.test(m)));

  for (const fallback of ["gpt-5.5", "claude-opus-4-8", "gemini-3.1-pro", "composer-2.5"]) add(fallback);
  return out.length ? out : models;
}

function opencodeFamily(model: string): string | null {
  const id = model.split("/").pop() ?? model;
  if (/deepseek-v\d/i.test(id)) return id.includes("flash") ? "deepseek-flash" : "deepseek-pro";
  if (/^glm-\d/i.test(id)) return "glm";
  if (/kimi-k/i.test(id)) return id.includes("code") ? "kimi-code" : "kimi";
  if (/qwen3.*max/i.test(id)) return "qwen-max";
  if (/qwen3.*plus/i.test(id)) return "qwen-plus";
  if (/minimax-m/i.test(id)) return "minimax";
  if (/mimo-v/i.test(id)) return id.includes("pro") ? "mimo-pro" : "mimo";
  if (/fugu-ultra/i.test(id)) return "fugu-ultra";
  if (/fugu$/i.test(id)) return "fugu";
  return null;
}

export function curateOpenCodeModels(
  models: string[],
  connectedProviderIds: readonly string[] = [],
): string[] {
  const out: string[] = [];
  // OpenCode publishes credential-free models in its live catalog. Keep these
  // dynamic instead of pinning one release in LFG: anonymous installs can then
  // follow provider additions/removals without an LFG release.
  const free = models.filter((model) => /^opencode\/.+-free$/.test(model));
  // ChatGPT subscription models (openai/*, present when opencode is logged in
  // via ChatGPT Plus/Pro OAuth) lead the picker. Mirror the codex harness
  // preference order, then stay future-proof by surfacing the newest release
  // of each plain gpt family OpenAI adds to the catalog.
  const openai = models.filter((model) => /^openai\/gpt-\d/.test(model));
  if (openai.length) {
    const available = new Set(openai.map((model) => model.slice("openai/".length)));
    for (const id of CODEX_MODELS) if (available.has(id)) out.push(`openai/${id}`);
    addLatest(out, openai.filter((model) => /^openai\/gpt-\d+(?:\.\d+)?$/.test(model)));
    addLatest(out, openai.filter((model) => /^openai\/gpt-\d+(?:\.\d+)?-mini$/.test(model)));
    addLatest(out, openai.filter((model) => /codex|spark/.test(model) && !model.endsWith("-fast")));
  }
  for (const model of free) if (!out.includes(model)) out.push(model);
  const preferred = models.filter((model) =>
    /^(opencode-go|fugu|sakana)\//.test(model) ||
    /^novita-ai\/(deepseek|moonshotai|qwen|zai-org|minimax|minimaxai|xiaomimimo)\//.test(model),
  );
  const byFamily = new Map<string, string[]>();
  for (const model of preferred) {
    const family = opencodeFamily(model);
    if (!family) continue;
    byFamily.set(family, [...(byFamily.get(family) ?? []), model]);
  }
  const order = [
    "deepseek-pro",
    "deepseek-flash",
    "glm",
    "kimi-code",
    "kimi",
    "qwen-max",
    "qwen-plus",
    "minimax",
    "mimo-pro",
    "fugu-ultra",
    "fugu",
  ];
  for (const family of order) addLatest(out, byFamily.get(family) ?? []);
  const connected = new Set(connectedProviderIds);
  for (const model of models) {
    const provider = model.slice(0, model.indexOf("/"));
    if (connected.has(provider) && !out.includes(model)) out.push(model);
  }
  return out.length ? out : models.slice(0, 16);
}

function curateCodexModels(models: string[]): string[] {
  const out: string[] = [];
  const add = (model: string) => {
    if (models.includes(model) && !out.includes(model)) out.push(model);
  };

  for (const model of CODEX_MODELS) add(model);
  addLatest(out, models.filter((m) => /^gpt-\d/.test(m) && !m.includes("codex") && !m.includes("mini")));
  addLatest(out, models.filter((m) => /^gpt-\d/.test(m) && m.includes("mini")));
  addLatest(out, models.filter((m) => /^gpt-\d/.test(m) && m.includes("codex") && !m.includes("spark")));
  addLatest(out, models.filter((m) => m.includes("spark")));
  for (const fallback of CODEX_MODELS) if (!out.includes(fallback) && models.includes(fallback)) out.push(fallback);
  return out.length ? out : models;
}

function curateGrokModels(models: string[]): string[] {
  const out: string[] = [];
  const add = (model: string) => {
    if (models.includes(model) && !out.includes(model)) out.push(model);
  };

  for (const model of GROK_MODELS) add(model);
  addLatest(out, models.filter((m) => /^grok-\d/.test(m)));
  addLatest(out, models.filter((m) => /^grok-composer/.test(m)));
  addLatest(out, models.filter((m) => /^grok-build/.test(m)));
  for (const model of models) add(model);
  return out.length ? out : models;
}

/**
 * `fx models --json` returns the whole AI Gateway catalog — 228 ids on a plain
 * account, most of them non-coding models. Dumping that into a picker is worse
 * than useless, so lead with the curated slice, then keep the rest reachable
 * behind it in the order the gateway listed them.
 */
function curateFxModels(models: string[]): string[] {
  const out: string[] = [];
  const add = (model: string) => {
    if (models.includes(model) && !out.includes(model)) out.push(model);
  };

  for (const model of FX_MODELS) add(model);
  for (const model of models) add(model);
  return out.length ? out : models;
}

// Discovery already drops the contributor twins; this also guards a stale
// cache or a hand-typed id so the picker never carries one.
function curateMuseModels(models: string[]): string[] {
  const out = models.filter((model) => model !== "auto" && !model.endsWith("-contributor"));
  return out.length ? out : [...MUSE_MODELS];
}

function curateModels(
  agent: CodingAgentKind,
  models: string[],
  connectedProviderIds: readonly string[] = [],
): string[] {
  if (agent === "cursor") return curateCursorModels(models);
  if (agent === "opencode") return curateOpenCodeModels(models, connectedProviderIds);
  if (agent === "codex" || agent === "codex-aisdk") return curateCodexModels(models);
  if (agent === "grok") return curateGrokModels(models);
  if (agent === "fx") return curateFxModels(models);
  if (agent === "muse") return curateMuseModels(models);
  return models;
}

export function rawModelsForAgent(agent: CodingAgentKind): string[] {
  const fallback = MODEL_OPTIONS[agent]?.models;
  const provider = readModelDiscoveryCacheSync()?.providers?.[agent];
  // A successful harness query is authoritative. Unioning it with the static
  // fallback kept removed providers (notably opencode-go) selectable forever,
  // even after the installed CLI said those providers did not exist.
  return discoveredModelsOrFallback(fallback, provider);
}

export function modelsForAgent(
  agent: CodingAgentKind,
  connectedProviderIds: readonly string[] = [],
): string[] {
  return curateModels(agent, rawModelsForAgent(agent), connectedProviderIds);
}

export function resolveModelForAgent(
  agent: CodingAgentKind,
  model: string | undefined,
  thinkingLevel?: string,
): string | undefined {
  if (!model) return undefined;
  if (agent !== "cursor" || model === "auto") return model;
  const raw = rawModelsForAgent("cursor");
  if (raw.includes(model)) return model;
  const requestedLevel = thinkingLevel ? CURSOR_LEVEL_ALIASES[thinkingLevel] ?? thinkingLevel : undefined;
  const variants = raw.map(parseCursorVariant).filter((item) => item.base === model);
  if (!variants.length) return model;
  const score = (item: CursorVariant) => {
    let value = item.fast ? 0 : 4;
    if (requestedLevel && item.level === requestedLevel) value += 100;
    if (!requestedLevel && !item.level) value += 80;
    if (!requestedLevel && item.level === "high") value += 60;
    if (requestedLevel === "xhigh" && item.level === "xhigh") value += 20;
    if (requestedLevel === "xhigh" && item.level === "max") value += 12;
    // Mirror of the above. Without it, asking for "max" on a family that stops
    // at xhigh (every cursor-grok build) matched nothing, left all variants tied
    // on 4, and handed back whichever the catalog happened to list first — which
    // is `-low`, the quietest possible downgrade of an explicit max request.
    if (requestedLevel === "max" && item.level === "xhigh") value += 12;
    if (requestedLevel === "high" && item.level === "medium") value += 8;
    if (!item.level) value += 2;
    return value;
  };
  return [...variants].sort((a, b) => score(b) - score(a))[0]?.raw ?? model;
}

export function thinkingLevelsForAgent(
  agent: string,
  model?: string,
): readonly string[] | null {
  if (agent === "opencode") {
    const variants = readModelDiscoveryCacheSync()?.providers?.opencode?.variants ?? {};
    if (model) return variants[model] ?? null;
    const levels = [...new Set(Object.values(variants).flat())];
    return levels.length ? levels : null;
  }
  if (agent === "claude" || agent === "aisdk") return CLAUDE_THINKING_LEVELS;
  // grok and pi drive their own CLIs with narrower vocabularies; offering more
  // hands the user a level that either kills the session or does nothing.
  if (agent === "grok") return GROK_THINKING_LEVELS;
  if (agent === "pi") return PI_THINKING_LEVELS;
  if (agent === "jcode") return JCODE_THINKING_LEVELS;
  if (agent === "codex" || agent === "codex-aisdk") return CODEX_THINKING_LEVELS;
  if (agent === "cursor") return CURSOR_THINKING_LEVELS;
  if (agent === "muse") return MUSE_THINKING_LEVELS;
  return null;
}

/**
 * Agents whose "connected" state means A PERSON SIGNED THIS BOX IN, which is
 * what the hosted-visitor guard is really asking about.
 *
 * `opencode` belongs here, and leaving it out was a real bug. Someone who pays
 * for OpenCode Go and uses nothing else connected their key, saw
 * `opencode-go: connected`, and still got the free Zen tier forever — because
 * this set decided the box was anonymous. The paid models they were being
 * billed for never appeared. It looked like a stale catalog and was not: the
 * catalog had all 23, and this gate dropped them.
 *
 * It hid behind the fact that most boxes have Claude or Codex signed in too,
 * so the gate passed for the wrong reason and the bug only showed on a box
 * with OpenCode alone.
 *
 * This does NOT weaken the second gate. `openCodeConnectedFrom` still decides
 * whether OpenCode itself can reach a paid provider, so a Claude account
 * cannot unlock opencode-go/* on a box OpenCode was never signed into — see
 * the test that pins exactly that.
 */
const ACCOUNT_OWNED_AGENT_KEYS = new Set<CodingAgentKind>([
  "claude",
  "aisdk",
  "codex",
  "codex-aisdk",
  "opencode",
]);

/** Prefixes that gate a pi model behind a sign-in, from pi-auth's provider list. */
const PI_GATED_PROVIDER_IDS = new Set<string>(PI_AUTH_PROVIDER_IDS);

export function hasConnectedModelAccount(codingAgents: CodingAgentInfo[]): boolean {
  return codingAgents.some(
    (agent) =>
      ACCOUNT_OWNED_AGENT_KEYS.has(agent.key) &&
      agent.status.accountConnected === true,
  );
}

/**
 * pi's connected providers, as the coding-agent status reports them. Passed
 * separately from `accountConnected` because pi is the one agent where "signed
 * in" is per provider rather than one account for the whole kind.
 */
export type PiProviderState = { id: string; connected: boolean };

function piProvidersFrom(codingAgents: CodingAgentInfo[]): PiProviderState[] {
  return codingAgents.find((agent) => agent.key === "pi")?.status.providers ?? [];
}

/**
 * Whether OpenCode itself holds a credential on this box.
 *
 * Separate from `hasConnectedModelAccount` on purpose. That one answers "is
 * this box's owner signed in anywhere", which is the hosted-visitor guard; it
 * says nothing about whether `opencode` can reach a paid provider. Gating the
 * OpenCode picker on it alone meant connecting a *Claude* account unlocked the
 * whole OpenCode catalog — openai/* and opencode-go/* included — on a box whose
 * OpenCode had never been signed into, so every one of those models was offered
 * and then failed at launch, while the free Zen models it could actually run
 * were pushed off the list.
 */
function openCodeConnectedFrom(codingAgents: CodingAgentInfo[]): boolean {
  return codingAgents.find((agent) => agent.key === "opencode")?.status.accountConnected === true;
}

function openCodeProvidersFrom(codingAgents: CodingAgentInfo[]): string[] {
  return (codingAgents.find((agent) => agent.key === "opencode")?.status.providers ?? [])
    .filter((provider) => provider.connected)
    .map((provider) => provider.id);
}

/** Models the current user can honestly launch from the picker. */
export function accessibleModelsForAgent(
  key: CodingAgentKind,
  models: string[],
  accountConnected: boolean,
  piProviders: readonly PiProviderState[] = [],
  openCodeConnected = false,
): string[] {
  if (key === "pi") {
    // Every pi model belongs to a provider: a `<providerId>/` prefix names it,
    // and everything else — including Anthropic's own slashed custom ids like
    // deepseek/deepseek-v4-flash — belongs to Anthropic. Offer a model only
    // when its provider is signed in, or picking pi after connecting just
    // ChatGPT would default to `sonnet` and launch against Anthropic with no
    // Anthropic credential at all.
    const connected = new Set(piProviders.filter((p) => p.connected).map((p) => p.id));
    const reachable = models.filter((model) => {
      const slash = model.indexOf("/");
      const prefix = slash > 0 ? model.slice(0, slash) : null;
      if (prefix && PI_GATED_PROVIDER_IDS.has(prefix)) return connected.has(prefix);
      return connected.has("anthropic");
    });
    // With nothing connected pi is already reported as unconfigured and gets
    // filtered out of the composer; show its default list rather than an empty
    // picker for the surfaces that render it anyway.
    return reachable.length ? reachable : models.filter((model) => !model.includes("/"));
  }
  if (key !== "opencode") return models;
  // Both gates have to pass. The account gate keeps a hosted box anonymous
  // until its owner signs in; the OpenCode gate keeps us from advertising
  // providers this box has no credential for. A cached catalog outlives the
  // credential that produced it, so the second one is not implied by the first.
  if (accountConnected && openCodeConnected) return models;
  const anonymous = models.filter((model) => /^opencode\/.+-free$/.test(model));
  return anonymous.length ? anonymous : [...OPENCODE_MODELS];
}

export function defaultModelForCatalogItem(
  key: CodingAgentKind,
  models: string[],
  /** True only when the full OpenCode catalog is on offer — see the gates above. */
  fullOpenCodeCatalog: boolean,
): string {
  if (key === "opencode" && !fullOpenCodeCatalog) {
    const free = models.find((model) => /^opencode\/.+-free$/.test(model));
    if (free) return free;
  }
  // Muse: discovery lists the catalog newest release first, and the newest
  // muse-spark is the one to launch — never a pinned id that ages.
  if (key === "muse") return models[0] ?? MODEL_OPTIONS.muse.defaultModel;
  return models.includes(MODEL_OPTIONS[key].defaultModel)
    ? MODEL_OPTIONS[key].defaultModel
    : models[0] ?? MODEL_OPTIONS[key].defaultModel;
}

/** Resolve the current default from the same catalog the picker renders. */
export function defaultModelForAgent(
  key: CodingAgentKind,
  codingAgents: CodingAgentInfo[] = [],
): string {
  const accountConnected = hasConnectedModelAccount(codingAgents);
  const openCodeConnected = openCodeConnectedFrom(codingAgents);
  const openCodeProviders = openCodeProvidersFrom(codingAgents);
  return defaultModelForCatalogItem(
    key,
    accessibleModelsForAgent(
      key,
      modelsForAgent(key, key === "opencode" ? openCodeProviders : []),
      accountConnected,
      piProvidersFrom(codingAgents),
      openCodeConnected,
    ),
    accountConnected && openCodeConnected,
  );
}

export function listModelCatalog(codingAgents: CodingAgentInfo[] = []): ModelCatalogItem[] {
  const configured = new Map(codingAgents.map((agent) => [agent.key, agent]));
  const accountConnected = hasConnectedModelAccount(codingAgents);
  const openCodeConnected = openCodeConnectedFrom(codingAgents);
  const openCodeProviders = openCodeProvidersFrom(codingAgents);
  const piProviders = piProvidersFrom(codingAgents);
  return MODEL_CATALOG_KEYS.map((key) => {
    const status = configured.get(key);
    const models = accessibleModelsForAgent(
      key,
      modelsForAgent(key, key === "opencode" ? openCodeProviders : []),
      accountConnected,
      piProviders,
      openCodeConnected,
    );
    const thinkingLevelsByModel = key === "opencode"
      ? Object.fromEntries(
          models.flatMap((model) => {
            const levels = thinkingLevelsForAgent(key, model);
            return levels?.length ? [[model, [...levels]]] : [];
          }),
        )
      : undefined;
    const thinkingLevels = key === "opencode"
      ? [...new Set(Object.values(thinkingLevelsByModel ?? {}).flat())]
      : [...(thinkingLevelsForAgent(key) ?? [])];
    return {
      key,
      label: LABELS[key],
      defaultModel: defaultModelForCatalogItem(key, models, accountConnected && openCodeConnected),
      models,
      thinkingLevels,
      ...(thinkingLevelsByModel && Object.keys(thinkingLevelsByModel).length
        ? { thinkingLevelsByModel }
        : {}),
      session: key !== "claude" && key !== "codex",
      auto: (AUTO_AGENT_BACKENDS as readonly string[]).includes(key),
      visible: status?.visible,
      configured: status?.status.configured,
    };
  });
}

export type AgentBrowserTree = {
  models: ModelCatalogItem[];
  skills: SkillCatalogItem[];
  insightAgents: Array<{
    name: string;
    title: string;
    enabled: boolean;
    inputs: string[];
    skills: string[];
    path: string;
  }>;
  autoAgents: Array<{
    id: string;
    name: string;
    enabled: boolean;
    backend: AutoAgentBackend;
    model?: string;
    schedule: string;
    cwd?: string;
    skills: string[];
    lastRunAt?: number;
  }>;
  runtimeSessions: Array<{
    sessionId: string;
    nativeSessionId?: string | null;
    title: string;
    agent: string;
    model?: string | null;
    project: string;
    parentSessionId?: string | null;
    parentNativeSessionId?: string | null;
    parentAgent?: string | null;
    spawnedBy?: string | null;
    busy?: boolean;
  }>;
  groups: {
    providers: Array<{
      key: string;
      label: string;
      defaultModel: string;
      models: string[];
      autoAgents: string[];
      insightAgents: string[];
    }>;
    skills: Array<{
      trigger: string;
      source: string;
      autoAgents: string[];
      insightAgents: string[];
    }>;
    runtimeParents: Array<{
      parentSessionId: string;
      children: string[];
    }>;
  };
};

function skillRefs(text: string, skills: SkillCatalogItem[]): string[] {
  const refs = new Set<string>();
  for (const skill of skills) {
    const escaped = skill.trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\$${escaped}(?=\\s|$|[.,;:)\\]])`).test(text)) refs.add(skill.trigger);
  }
  return [...refs].sort((a, b) => a.localeCompare(b));
}

export function buildAgentBrowserTree(input: {
  skills: SkillCatalogItem[];
  insightAgents: Agent[];
  autoAgents: AutoAgent[];
  codingAgents?: CodingAgentInfo[];
  sessions?: Session[];
}): AgentBrowserTree {
  const models = listModelCatalog(input.codingAgents);
  const insightAgents = input.insightAgents.map((agent) => ({
    name: agent.name,
    title: agent.frontmatter.title ?? agent.name,
    enabled: agent.frontmatter.enabled !== false,
    inputs: (agent.frontmatter.inputs ?? []).map((item) => item.kind),
    skills: skillRefs(agent.raw, input.skills),
    path: agent.filePath,
  }));
  const autoAgents = input.autoAgents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    enabled: agent.enabled,
    backend: (agent.agent ?? "aisdk") as AutoAgentBackend,
    model: agent.model,
    schedule: agent.schedule,
    cwd: agent.cwd,
    skills: skillRefs(agent.prompt, input.skills),
    lastRunAt: agent.lastRunAt,
  }));
  const runtimeSessions = (input.sessions ?? [])
    .filter((session) => !!session.sessionId)
    .map((session) => ({
      sessionId: session.sessionId!,
      nativeSessionId: session.nativeSessionId,
      title: session.title,
      agent: session.agent,
      model: session.model,
      project: session.project,
      parentSessionId: session.parentSessionId,
      parentNativeSessionId: session.parentNativeSessionId,
      parentAgent: session.parentAgent,
      spawnedBy: session.spawnedBy,
      busy: session.busy,
    }));
  const childrenByParent = new Map<string, string[]>();
  for (const session of runtimeSessions) {
    const parent = session.parentSessionId ?? session.parentNativeSessionId;
    if (!parent) continue;
    childrenByParent.set(parent, [...(childrenByParent.get(parent) ?? []), session.sessionId]);
  }
  return {
    models,
    skills: input.skills,
    insightAgents,
    autoAgents,
    runtimeSessions,
    groups: {
      providers: models.map((model) => ({
        key: model.key,
        label: model.label,
        defaultModel: model.defaultModel,
        models: model.models,
        autoAgents: autoAgents
          .filter((agent) => agent.backend === model.key)
          .map((agent) => agent.id),
        insightAgents: insightAgents
          .filter((agent) => agent.title.toLowerCase().includes(model.label.toLowerCase()))
          .map((agent) => agent.name),
      })),
      skills: input.skills.map((skill) => ({
        trigger: skill.trigger,
        source: skill.source,
        autoAgents: autoAgents
          .filter((agent) => agent.skills.includes(skill.trigger))
          .map((agent) => agent.id),
        insightAgents: insightAgents
          .filter((agent) => agent.skills.includes(skill.trigger))
          .map((agent) => agent.name),
      })),
      runtimeParents: [...childrenByParent.entries()].map(([parentSessionId, children]) => ({
        parentSessionId,
        children,
      })),
    },
  };
}
