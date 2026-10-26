import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  openCodeConfigPath,
  readOpenCodeConfig,
  writeOpenCodeConfig,
  type OmgProviderOptions,
} from "./omg-provider.ts";

/**
 * Custom models: OpenAI-compatible endpoints the box owner adds by hand, such
 * as a vLLM or llama.cpp server on a home GPU.
 *
 * `~/.omg/models.json` is the one owner. Its models join the omg agent's
 * picker as `custom-<provider>/<model>`, which is also the OpenCode model id:
 * ensureCustomProviders writes each provider into OpenCode's config next to
 * the hosted `omg` provider, and the omg agent runs both through OpenCode.
 *
 * {
 *   "providers": [{
 *     "id": "pc", "name": "3060 Ti",
 *     "baseURL": "http://100.79.118.10:8000/v1", "apiKey": "optional",
 *     "models": [{ "id": "gemma-4-e4b", "context": 24576, "output": 4096, "input": ["text", "image"] }]
 *   }]
 * }
 */

export const CUSTOM_PROVIDER_PREFIX = "custom-";

export type CustomModel = {
  id: string;
  name?: string;
  /** Context window in tokens. OpenCode compacts the chat before it is full. */
  context?: number;
  /** Most tokens one reply may use. */
  output?: number;
  input: readonly ("text" | "image")[];
};

export type CustomProvider = {
  id: string;
  name?: string;
  baseURL: string;
  apiKey?: string;
  models: CustomModel[];
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Model ids may carry a slash (`Qwen/Qwen3-8B`); OpenCode splits on the first.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const DEFAULT_OUTPUT = 4096;

export function customModelsPath(options: { home?: string } = {}): string {
  // HOME first: Bun caches os.homedir() at startup.
  return join(options.home ?? (process.env.HOME?.trim() || homedir()), ".omg", "models.json");
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function parseModel(raw: unknown): CustomModel | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || !MODEL_ID.test(value.id)) return null;
  const input = Array.isArray(value.input) && value.input.includes("image") ? (["text", "image"] as const) : (["text"] as const);
  return {
    id: value.id,
    ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
    ...(positiveInt(value.context) ? { context: positiveInt(value.context) } : {}),
    ...(positiveInt(value.output) ? { output: positiveInt(value.output) } : {}),
    input,
  };
}

/** Parse the file body. Bad entries are dropped so one typo hides one model, not all. */
export function parseCustomModels(text: string): CustomProvider[] {
  let data: unknown;
  try {
    data = Bun.JSONC.parse(text);
  } catch {
    return [];
  }
  const providers = (data as { providers?: unknown })?.providers;
  if (!Array.isArray(providers)) return [];
  const seen = new Set<string>();
  const out: CustomProvider[] = [];
  for (const raw of providers) {
    if (!raw || typeof raw !== "object") continue;
    const value = raw as Record<string, unknown>;
    if (typeof value.id !== "string" || !ID.test(value.id) || seen.has(value.id)) continue;
    if (typeof value.baseURL !== "string" || !/^https?:\/\/\S+$/.test(value.baseURL)) continue;
    const models = (Array.isArray(value.models) ? value.models : []).map(parseModel).filter((m): m is CustomModel => !!m);
    const unique = models.filter((model, index) => models.findIndex((other) => other.id === model.id) === index);
    if (!unique.length) continue;
    seen.add(value.id);
    out.push({
      id: value.id,
      ...(typeof value.name === "string" && value.name.trim() ? { name: value.name.trim() } : {}),
      baseURL: value.baseURL.replace(/\/+$/, ""),
      ...(typeof value.apiKey === "string" && value.apiKey ? { apiKey: value.apiKey } : {}),
      models: unique,
    });
  }
  return out;
}

// The catalog reads this on every picker render; re-parse only when the file changes.
let cache: { path: string; mtimeMs: number; size: number; providers: CustomProvider[] } | null = null;

export function loadCustomModels(options: { home?: string } = {}): CustomProvider[] {
  const path = customModelsPath(options);
  if (!existsSync(path)) return [];
  try {
    const stat = statSync(path);
    if (cache && cache.path === path && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.providers;
    const providers = parseCustomModels(readFileSync(path, "utf8"));
    cache = { path, mtimeMs: stat.mtimeMs, size: stat.size, providers };
    return providers;
  } catch {
    return [];
  }
}

export function customModelId(provider: string, model: string): string {
  return `${CUSTOM_PROVIDER_PREFIX}${provider}/${model}`;
}

/** Picker ids for every configured model, in file order. */
export function customModelIds(options: { home?: string } = {}): string[] {
  return loadCustomModels(options).flatMap((provider) => provider.models.map((model) => customModelId(provider.id, model.id)));
}

/** Display names the owner set with `name`, keyed by picker id. */
export function customModelLabels(options: { home?: string } = {}): Record<string, string> {
  return Object.fromEntries(loadCustomModels(options).flatMap((provider) =>
    provider.models.flatMap((model) => (model.name ? [[customModelId(provider.id, model.id), model.name]] : [])),
  ));
}

export function isCustomModel(model: string | undefined | null): boolean {
  return !!model && model.startsWith(CUSTOM_PROVIDER_PREFIX) && model.includes("/");
}

export function findCustomModel(
  model: string,
  options: { home?: string } = {},
): { provider: CustomProvider; model: CustomModel } | null {
  if (!isCustomModel(model)) return null;
  for (const provider of loadCustomModels(options)) {
    const prefix = `${CUSTOM_PROVIDER_PREFIX}${provider.id}/`;
    if (!model.startsWith(prefix)) continue;
    const found = provider.models.find((entry) => entry.id === model.slice(prefix.length));
    if (found) return { provider, model: found };
  }
  return null;
}

/** Input modalities for a configured custom model, or null when it is not one. */
export function customInputModalities(model: string, options: { home?: string } = {}): readonly ("text" | "image")[] | null {
  return findCustomModel(model, options)?.model.input ?? null;
}

function openCodeProvider(provider: CustomProvider, detected: DetectedContexts) {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: provider.name ?? provider.id,
    // The openai-compatible provider wants a non-empty key; a local server
    // with no auth ignores it.
    options: { baseURL: provider.baseURL, apiKey: provider.apiKey ?? "none" },
    models: Object.fromEntries(provider.models.map((model) => {
      // The file wins; otherwise the size the server reported. OpenCode
      // compacts the chat against this limit.
      const context = model.context ?? positiveInt(detected[customModelId(provider.id, model.id)]?.context);
      return [model.id, {
      name: model.name ?? model.id,
      ...(context
        ? { limit: { context, output: Math.min(model.output ?? DEFAULT_OUTPUT, context) } }
        : {}),
      // Without modalities OpenCode drops every image part (see omg-provider.ts).
      attachment: model.input.includes("image"),
      modalities: { input: [...model.input], output: ["text"] },
    }];
    })),
  };
}

/**
 * Mirror ~/.omg/models.json into OpenCode's config. Every `custom-*` provider
 * there belongs to this file: one removed from it is removed from OpenCode.
 */
export function ensureCustomProviders(options: OmgProviderOptions = {}): void {
  const providers = loadCustomModels(options);
  const path = openCodeConfigPath(options);
  if (!providers.length && !existsSync(path)) return;
  const current = readOpenCodeConfig(path);
  const owned = Object.keys(current.provider ?? {}).some((key) => key.startsWith(CUSTOM_PROVIDER_PREFIX));
  if (!providers.length && !owned) return;
  const kept = Object.fromEntries(
    Object.entries((current.provider ?? {}) as Record<string, unknown>).filter(([key]) => !key.startsWith(CUSTOM_PROVIDER_PREFIX)),
  );
  const detected = readDetectedContexts(options);
  const custom = Object.fromEntries(providers.map((provider) => [`${CUSTOM_PROVIDER_PREFIX}${provider.id}`, openCodeProvider(provider, detected)]));
  const next = { ...current, provider: { ...kept, ...custom } };
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  writeOpenCodeConfig(path, next);
}

/**
 * Context sizes read from the servers themselves, cached on disk because the
 * OpenCode harness runs in its own process. Keyed by picker id.
 */
type DetectedContexts = Record<string, { context: number; at: number }>;

function detectedContextsPath(options: { home?: string } = {}): string {
  return join(dirname(customModelsPath(options)), "cache", "custom-model-context.json");
}

function readDetectedContexts(options: { home?: string } = {}): DetectedContexts {
  try {
    const value = JSON.parse(readFileSync(detectedContextsPath(options), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** The context a model runs with: `context` from the file wins, then the size its server reported. */
export function customModelContext(model: string, options: { home?: string } = {}): number | undefined {
  const found = findCustomModel(model, options);
  if (!found) return undefined;
  return found.model.context ?? positiveInt(readDetectedContexts(options)[model]?.context);
}

async function getJson(url: string, apiKey: string | undefined, fetcher: typeof fetch): Promise<any> {
  const response = await fetcher(url, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

/**
 * Ask each provider for its context size and cache the answers.
 *  - vLLM: `max_model_len` on each entry of GET /v1/models.
 *  - llama.cpp: `n_ctx` from GET /props (one model per server).
 * Ollama is not read: its served context (num_ctx) is not in any response.
 * A server that does not answer keeps its last cached value. Never throws.
 */
export async function refreshCustomModelContexts(
  options: { home?: string; fetcher?: typeof fetch } = {},
): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const providers = loadCustomModels(options);
  if (!providers.length) return;
  const cached = readDetectedContexts(options);
  const next: DetectedContexts = {};
  const now = Date.now();
  await Promise.all(providers.map(async (provider) => {
    const found: Record<string, number> = {};
    try {
      const body = await getJson(`${provider.baseURL}/models`, provider.apiKey, fetcher);
      for (const entry of Array.isArray(body?.data) ? body.data : []) {
        const context = positiveInt(entry?.max_model_len);
        if (typeof entry?.id === "string" && context) found[entry.id] = context;
      }
    } catch {}
    if (provider.models.some((model) => !found[model.id])) {
      try {
        const body = await getJson(`${provider.baseURL.replace(/\/v1$/, "")}/props`, provider.apiKey, fetcher);
        const context = positiveInt(body?.default_generation_settings?.n_ctx) ?? positiveInt(body?.n_ctx);
        if (context) for (const model of provider.models) found[model.id] ??= context;
      } catch {}
    }
    for (const model of provider.models) {
      const id = customModelId(provider.id, model.id);
      if (found[model.id]) next[id] = { context: found[model.id]!, at: now };
      else if (cached[id]) next[id] = cached[id]!;
    }
  }));
  if (JSON.stringify(next) === JSON.stringify(cached)) return;
  const path = detectedContextsPath(options);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  } catch {}
}

/**
 * How many omg.dev MCP tools a custom model can carry. OpenCode sends every
 * tool description with every request, and the hardcoded sizes below were
 * measured 2026-10-12 on custom-pc/gemma-4-e4b (OpenCode 1.18):
 *  - base prompt and built-in tools: about 14k tokens;
 *  - omg (59 tools, 58k chars) plus computer (10 tools, 5k chars): about 17k;
 *  - connectors (121 tools, 723k chars): about 200k.
 * A 24k model with every server attached was sent 867k characters and every
 * turn failed. Hosted models are not limited.
 */
const FULL_OMG_MIN_CONTEXT = 49_152;
const CONNECTORS_MIN_CONTEXT = 262_144;

/**
 * The lite set: the omg tools a small model needs to show and deliver its
 * work, about 5.6k chars (1.6k tokens) together. OpenCode names an MCP tool
 * `<server>_<tool>`, so omg_ship is `omg_omg_ship`.
 */
export const LITE_OMG_TOOLS = [
  "omg_ship",
  "omg_display_image",
  "omg_display_file",
  "omg_deploy",
  "omg_deploy_status",
] as const;

/**
 * OpenCode `tools` entries for one turn, or null when nothing is cut.
 *  - under 48k (or unknown): the lite omg set only;
 *  - 48k to under 256k: every omg and computer tool, no connectors;
 *  - 256k or more: everything.
 * OpenCode applies the entries in order and the last match wins, so the
 * `<server>_*` switch-offs come before the lite tools that turn back on.
 * Applied per turn, so a session that switches models keeps working.
 */
export function customModelToolFilter(model: string, options: { home?: string } = {}): Record<string, boolean> | null {
  if (!findCustomModel(model, options)) return null;
  const context = customModelContext(model, options) ?? 0;
  if (context >= CONNECTORS_MIN_CONTEXT) return null;
  if (context >= FULL_OMG_MIN_CONTEXT) return { "connectors_*": false };
  return {
    "omg_*": false,
    "computer_*": false,
    "connectors_*": false,
    ...Object.fromEntries(LITE_OMG_TOOLS.map((tool) => [`omg_${tool}`, true])),
  };
}

/**
 * Whether each custom model's server answers, for the picker. Keyed by picker id.
 *
 * The probe is `GET <baseURL>/models` WITHOUT the key, so it never wakes a
 * scale-to-zero GPU host: Modal's proxy auth turns away an unkeyed request at
 * its edge with a 401 and starts nothing. Any answer counts as online (401
 * included), except 404 and 5xx: a stopped Modal app answers 404
 * ("modal-http: invalid function call"), a reverse proxy whose backend is down
 * answers 502 to 504, and llama.cpp answers 503 while it loads. No answer
 * within 3 s is offline too.
 */
export type CustomModelStatus = Record<string, { online: boolean }>;

const STATUS_TTL_MS = 15_000;
let statusCache: { key: string; at: number; status: CustomModelStatus } | null = null;
let statusInFlight: { key: string; promise: Promise<CustomModelStatus> } | null = null;

async function providerOnline(provider: CustomProvider, fetcher: typeof fetch): Promise<boolean> {
  try {
    const response = await fetcher(`${provider.baseURL}/models`, { signal: AbortSignal.timeout(3000) });
    await response.body?.cancel().catch(() => {});
    return response.status !== 404 && response.status < 500;
  } catch {
    return false;
  }
}

/** Never throws. Answers from a 15 s cache; concurrent callers share one probe. */
export async function customModelStatus(
  options: { home?: string; fetcher?: typeof fetch; now?: number } = {},
): Promise<CustomModelStatus> {
  const providers = loadCustomModels(options);
  if (!providers.length) return {};
  const key = JSON.stringify(providers.map((provider) => [provider.id, provider.baseURL, provider.models.map((model) => model.id)]));
  const now = options.now ?? Date.now();
  if (statusCache?.key === key && now - statusCache.at < STATUS_TTL_MS) return statusCache.status;
  if (statusInFlight?.key === key) return statusInFlight.promise;
  const fetcher = options.fetcher ?? fetch;
  const promise = Promise.all(providers.map(async (provider) => {
    const online = await providerOnline(provider, fetcher);
    return provider.models.map((model) => [customModelId(provider.id, model.id), { online }] as const);
  })).then((rows) => {
    const status: CustomModelStatus = Object.fromEntries(rows.flat());
    statusCache = { key, at: options.now ?? Date.now(), status };
    return status;
  }).finally(() => {
    if (statusInFlight?.promise === promise) statusInFlight = null;
  });
  statusInFlight = { key, promise };
  return promise;
}

/** Test seam: forget the cached probe. */
export function resetCustomModelStatusCache(): void {
  statusCache = null;
  statusInFlight = null;
}
