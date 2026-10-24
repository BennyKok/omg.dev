// The cheapest hosted model owns small internal tasks such as session titles.
// Keep this explicit: picker order is a UX choice, not a pricing contract.
export const OMG_CHEAPEST_MODEL = "omg/deepseek/deepseek-v4-flash-0731";

/**
 * The model a new omg session runs when nothing names one: first run,
 * scheduled tasks, and any client that sends no model. One constant; set it
 * back to OMG_CHEAPEST_MODEL to revert.
 *
 * claude-haiku-5.5 (user decision, 2026-10-12, after the Opus 5.5 app
 * benchmark). It reads images and runs at its own default thinking level.
 * Before that the default was gpt-6-luna (2026-09-30); set it back to
 * "omg/openai/gpt-6-luna" to revert. The hosted default lives in vibes
 * control-plane/lib/omg-agent-models.ts and must move with this one.
 */
/**
 * Router aliases the hosted platform resolves per person (vibes
 * apps/infra/internal/proxy/model_alias.go). "Auto" lets the platform choose;
 * Max, Balanced and Fast are the manual levels. Their concrete models can be
 * re-pointed on the router, for one person, a plan or everyone, without an
 * lfg release. The "omg/" prefix is the provider; the router id is "omg/auto".
 */
export const OMG_AUTO_MODEL = "omg/omg/auto";
export const OMG_LEVEL_MODELS: readonly string[] = [
  OMG_AUTO_MODEL,
  "omg/omg/max",
  "omg/omg/balanced",
  "omg/omg/fast",
];

/**
 * The first build of a new app on Auto (src/auto-build-model.ts). Listed so
 * the session can launch on it; the picker does not offer it.
 */
export const OMG_BUILD_MODEL = "omg/omg/build";

export function isOmgLevelModel(model: string | null | undefined): boolean {
  return !!model && OMG_LEVEL_MODELS.includes(model);
}

/**
 * The fixed model credit use is compared against. It must be a concrete
 * model: an alias can be re-pointed, and every comparison would move with it.
 */
export const OMG_PRICE_BASELINE_MODEL = "omg/anthropic/claude-haiku-5.5";

// Auto since 2026-10-24 (user decision): the platform picks the model. Before
// that it was claude-haiku-5.5, which is also Auto's router default. Set it
// back to OMG_PRICE_BASELINE_MODEL to revert.
export const OMG_DEFAULT_MODEL = OMG_AUTO_MODEL;

/**
 * One row of the omg agent list, as the router serves it from
 * GET /api/cli/llm/v1/models?agent=omg (vibes
 * apps/infra/internal/proxy/omg_agent_models.go). The router owns the list:
 * which models exist, their order, image input, thinking levels, and which
 * rows are an older generation. `id` is the router id, without "omg/".
 */
export type OmgCatalogEntry = {
  id: string;
  label: string;
  /** Older generation: hidden from the picker, still runs when saved. */
  deprecated?: boolean;
  imageInput?: boolean;
  thinkingLevels?: string[];
  defaultThinkingLevel?: string;
};

/** The level name that stands for "reasoning off" in the picker and in variants. */
export const OMG_THINKING_OFF = "off";

const TEXT = ["text"] as const;
const TEXT_IMAGE = ["text", "image"] as const;

/**
 * Picker models, in router order: the latest generation only. The array is
 * updated in place by applyOmgCatalog, so importers keep a live reference.
 * Before the first router answer it holds only the aliases, which the router
 * always resolves.
 */
export const OMG_MODELS: string[] = [];

/** Every model the omg agent can run, including older generations. */
export const OMG_RUNNABLE_MODELS: string[] = [];

/**
 * Input modalities of each runnable model. OpenCode's openai-compatible
 * provider sends an image part only when the model entry declares image
 * input. ensureOmgProvider writes these into the guest config and
 * modelSeesImages reads them. Only text and image are listed, because those
 * are the parts OpenCode sends.
 */
export const OMG_INPUT_MODALITIES_BY_MODEL: Record<string, readonly ("text" | "image")[]> = {};

/** Thinking levels the router honours per model. No entry = no selector. */
export const OMG_THINKING_LEVELS_BY_MODEL: Record<string, readonly string[]> = {};

const DEFAULT_THINKING_LEVEL_BY_MODEL: Record<string, string> = {};

let catalogFromRouter = false;

function replace<T>(target: T[], next: T[]): void {
  target.splice(0, target.length, ...next);
}

function replaceRecord<T>(target: Record<string, T>, next: Record<string, T>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, next);
}

/**
 * Replace the omg model list. `fromRouter` is false for the built-in alias
 * list and true for a router answer (live or cached on disk).
 */
export function applyOmgCatalog(entries: readonly OmgCatalogEntry[], fromRouter = true): void {
  const modalities: Record<string, readonly ("text" | "image")[]> = {};
  const levels: Record<string, readonly string[]> = {};
  const defaults: Record<string, string> = {};
  const runnable: string[] = [];
  const visible: string[] = [];
  for (const entry of entries) {
    const model = `omg/${entry.id}`;
    if (runnable.includes(model)) continue;
    runnable.push(model);
    if (!entry.deprecated) visible.push(model);
    modalities[model] = entry.imageInput ? TEXT_IMAGE : TEXT;
    if (entry.thinkingLevels?.length) levels[model] = [...entry.thinkingLevels];
    if (entry.defaultThinkingLevel) defaults[model] = entry.defaultThinkingLevel;
  }
  replace(OMG_RUNNABLE_MODELS, runnable);
  replace(OMG_MODELS, visible);
  replaceRecord(OMG_INPUT_MODALITIES_BY_MODEL, modalities);
  replaceRecord(OMG_THINKING_LEVELS_BY_MODEL, levels);
  replaceRecord(DEFAULT_THINKING_LEVEL_BY_MODEL, defaults);
  catalogFromRouter = fromRouter;
}

/** True once a router answer (live or cached) has replaced the alias list. */
export function omgCatalogFromRouter(): boolean {
  return catalogFromRouter;
}

/** True when the omg agent can run this model, including an older generation. */
export function isOmgRunnableModel(model: string): boolean {
  return OMG_RUNNABLE_MODELS.includes(model);
}

/** The alias list used before the router answers. */
export const OMG_ALIAS_CATALOG: readonly OmgCatalogEntry[] = [...OMG_LEVEL_MODELS, OMG_BUILD_MODEL].map((model) => ({
  id: model.slice("omg/".length),
  label: model.slice("omg/omg/".length),
  // When an alias points at a text-only model, the router describes the
  // image as text first (maybeConvertOpenAIImageInput).
  imageInput: true,
}));

applyOmgCatalog(OMG_ALIAS_CATALOG, false);

/** Input modalities for one hosted model, or null when it is not in the catalog. */
export function omgInputModalities(model: string): readonly ("text" | "image")[] | null {
  return OMG_INPUT_MODALITIES_BY_MODEL[model] ?? null;
}

/** Levels for one hosted model, or null when the router has no control for it. */
export function omgThinkingLevels(model: string): readonly string[] | null {
  return OMG_THINKING_LEVELS_BY_MODEL[model] ?? null;
}

/** The level a new session starts at when the model has its own default, else null. */
export function omgDefaultThinkingLevel(model: string): string | null {
  return DEFAULT_THINKING_LEVEL_BY_MODEL[model] ?? null;
}

/**
 * A model that starts with reasoning off. Claude Haiku 5.5 is one: with no
 * `reasoning` field it spends the output budget on reasoning, and only
 * `reasoning: { enabled: false }` holds it at zero (measured 2026-10-13).
 */
function reasoningOffByDefault(model: string): boolean {
  return omgDefaultThinkingLevel(model) === OMG_THINKING_OFF;
}

/**
 * Model-level OpenCode `options`, merged into every request body. Only the
 * reasoning-off models have any: the default request carries
 * `reasoning: { enabled: false }`.
 */
export function omgModelOptions(model: string): Record<string, unknown> | undefined {
  return reasoningOffByDefault(model) ? { reasoning: { enabled: false } } : undefined;
}

/**
 * The OpenCode variant for one level. OpenCode merges a variant over the model
 * options with a deep merge, so a chosen level sets `enabled: true` itself and
 * cannot be cancelled by the model default. Other models send the level as
 * `reasoning_effort`.
 */
export function omgVariantOptions(model: string, level: string): Record<string, unknown> {
  if (!reasoningOffByDefault(model)) return { reasoningEffort: level };
  return level === OMG_THINKING_OFF
    ? { reasoning: { enabled: false } }
    : { reasoning: { enabled: true, effort: level } };
}
