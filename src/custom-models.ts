import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

function openCodeProvider(provider: CustomProvider) {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: provider.name ?? provider.id,
    // The openai-compatible provider wants a non-empty key; a local server
    // with no auth ignores it.
    options: { baseURL: provider.baseURL, apiKey: provider.apiKey ?? "none" },
    models: Object.fromEntries(provider.models.map((model) => [model.id, {
      name: model.name ?? model.id,
      ...(model.context
        ? { limit: { context: model.context, output: Math.min(model.output ?? DEFAULT_OUTPUT, model.context) } }
        : {}),
      // Without modalities OpenCode drops every image part (see omg-provider.ts).
      attachment: model.input.includes("image"),
      modalities: { input: [...model.input], output: ["text"] },
    }])),
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
  const custom = Object.fromEntries(providers.map((provider) => [`${CUSTOM_PROVIDER_PREFIX}${provider.id}`, openCodeProvider(provider)]));
  const next = { ...current, provider: { ...kept, ...custom } };
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  writeOpenCodeConfig(path, next);
}
