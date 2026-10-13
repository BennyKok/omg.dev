import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { cloudApiBaseUrl, loadCloudCredentials } from "./cloud-account.ts";
import { OMG_MODELS, omgInputModalities, omgModelOptions, omgThinkingLevels, omgVariantOptions } from "./omg-models.ts";

const GUEST_PROXY = "http://169.254.0.1:9090";
export const OMG_SIGN_IN_REQUIRED = "Sign in with `omg login` to use the omg agent.";

type Config = Record<string, any>;
export type OmgProviderOptions = {
  home?: string;
  env?: Record<string, string | undefined>;
  guestConfigPath?: string;
};

function readConfig(path: string): Config {
  if (!existsSync(path)) return {};
  try {
    const value = Bun.JSONC.parse(readFileSync(path, "utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {}
  throw new Error(`Cannot update invalid JSON config: ${path}`);
}

/** True only for the managed AI proxy injected into a hosted Computer. */
export function hasHostedOmgAiProxy(options: OmgProviderOptions = {}): boolean {
  const env = options.env ?? process.env;
  return env.OMG_AI_URL?.trim().replace(/\/+$/, "").replace(/\/v1$/, "") === GUEST_PROXY;
}

/** The guest sets OMG_AI_URL; its preinstalled provider is a fallback marker. */
export function isHostedOmgSandbox(options: OmgProviderOptions = {}): boolean {
  if (hasHostedOmgAiProxy(options)) return true;
  const path = options.guestConfigPath ?? "/home/user/.config/opencode/opencode.jsonc";
  try { return !!readConfig(path).provider?.omg; } catch { return false; }
}

export function hasOmgProviderAccess(options: OmgProviderOptions = {}): boolean {
  if (isHostedOmgSandbox(options)) return true;
  return !!loadCloudCredentials(join(options.home ?? homedir(), ".omg", "credentials.json"));
}

/**
 * The guest proxy takes no credential of its own: the sandbox is the identity.
 * OpenCode's openai-compatible provider still wants a non-empty apiKey, so a
 * marker goes in its place.
 */
const GUEST_API_KEY = "omg-guest";

/**
 * Merge only our provider. JSONC takes precedence over JSON in OpenCode.
 *
 * Local install: the provider points at the cloud LLM route and carries the
 * `omg login` token. Hosted sandbox: the provider points at the guest proxy in
 * OMG_AI_URL. The hosted template used to pre-bake that provider and this
 * function trusted it and returned early. The template stopped shipping it
 * (vibes build-template.ts, step 5a), so on every fresh Computer the omg agent
 * was reported connected and then failed every turn with
 * "ProviderModelNotFoundError: Model not found: omg/...". A guest config that
 * already names the provider is still left byte-for-byte alone.
 */
/**
 * OpenCode input settings for one hosted model, from the model catalog.
 * `attachment` follows OpenCode's own rule for catalog models (true when any
 * input is not text); a config model otherwise defaults it to false.
 */
function omgInputConfig(model: string): { attachment: boolean; modalities: { input: string[]; output: string[] } } | undefined {
  const input = omgInputModalities(model);
  return input
    ? { attachment: input.some((kind) => kind !== "text"), modalities: { input: [...input], output: ["text"] } }
    : undefined;
}

/**
 * True when a hosted model that takes a level has no variants in this
 * provider, or its declared input modalities differ from the catalog. With no
 * `modalities`, OpenCode drops every image sent to an image-capable model.
 */
function missingOmgVariants(provider: { models?: Record<string, { variants?: unknown; options?: { reasoning?: unknown }; attachment?: unknown; modalities?: { input?: unknown } }> }): boolean {
  return OMG_MODELS.some((model) => {
    const entry = provider.models?.[model.slice("omg/".length)];
    const input = omgInputModalities(model);
    if (input && JSON.stringify(entry?.modalities?.input) !== JSON.stringify(input)) return true;
    if (input && entry?.attachment !== input.some((kind) => kind !== "text")) return true;
    const levels = omgThinkingLevels(model);
    if (!levels) return false;
    const variants = entry?.variants;
    if (!variants || typeof variants !== "object") return true;
    // Compare the full variant body, not just the name: an old Haiku entry has
    // `low` with `reasoningEffort`, which no longer turns reasoning on.
    const stale = levels.some((level) => JSON.stringify((variants as Record<string, unknown>)[level]) !== JSON.stringify(omgVariantOptions(model, level)));
    if (stale) return true;
    const options = omgModelOptions(model);
    return !!options && JSON.stringify((entry as { options?: { reasoning?: unknown } } | undefined)?.options?.reasoning) !== JSON.stringify(options.reasoning);
  });
}

/** The OpenCode config file that provider writers merge into. */
export function openCodeConfigPath(options: OmgProviderOptions = {}): string {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const dir = join(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), "opencode");
  // Match the existing MCP writer's opencode.json path on a new installation.
  const jsonc = join(dir, "opencode.jsonc");
  return existsSync(jsonc) ? jsonc : join(dir, "opencode.json");
}

export function readOpenCodeConfig(path: string): Config {
  return readConfig(path);
}

/** Atomic write; the file can hold an API key, so it stays owner-only. */
export function writeOpenCodeConfig(path: string, next: Config): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function ensureOmgProvider(options: OmgProviderOptions = {}): void {
  const env = options.env ?? process.env;
  const hosted = hasHostedOmgAiProxy(options);
  if (!hosted && isHostedOmgSandbox(options)) return;
  const home = options.home ?? homedir();
  const path = openCodeConfigPath(options);
  const current = readConfig(path);
  // A guest config that already names the provider is left alone, unless a
  // model that takes a thinking level has no variants yet (the level travels
  // as a variant, so without them a chosen level would silently do nothing),
  // or a model's input modalities differ from the catalog.
  const providerReady = hosted && current.provider?.omg && !missingOmgVariants(current.provider.omg);
  if (providerReady) return;
  const credentials = hosted ? null : loadCloudCredentials(join(home, ".omg", "credentials.json"));
  if (!hosted && !credentials) throw new Error(OMG_SIGN_IN_REQUIRED);
  const previous = current.provider?.omg ?? {};
  // The local CLI holds a control-plane OAuth token. Infra does not accept it, so
  // the local route goes through the control-plane CLI gate (control-plane/lib/cli.ts).
  // The guest proxy is infra itself, reached on the sandbox's link-local address.
  const baseURL = hosted
    ? `${env.OMG_AI_URL!.trim().replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`
    : `${cloudApiBaseUrl()}/api/cli/llm/v1`;
  const apiKey = hosted ? GUEST_API_KEY : credentials!.token;
  const provider = {
    ...current.provider,
    omg: {
      ...previous,
      npm: "@ai-sdk/openai-compatible",
      name: "omg",
      // A guest config that already routes stays routed its own way; only
      // the thinking variants and modalities are added to it.
      options: hosted && current.provider?.omg ? { ...previous.options } : { ...previous.options, baseURL, apiKey },
      models: {
        ...previous.models,
        ...Object.fromEntries(OMG_MODELS.map((model) => {
          const id = model.slice("omg/".length);
          // A thinking level travels as an OpenCode variant; the
          // openai-compatible provider sends it as `reasoning_effort`, or as
          // the `reasoning` object for models that default to reasoning off.
          const levels = omgThinkingLevels(model);
          const variants = levels
            ? Object.fromEntries(levels.map((level) => [level, omgVariantOptions(model, level)]))
            : undefined;
          const modelOptions = omgModelOptions(model);
          const prior = previous.models?.[id];
          return [id, {
            ...prior,
            name: id,
            ...(variants ? { variants: { ...prior?.variants, ...variants } } : {}),
            // Keep the user's other options; only the managed reasoning key is ours.
            ...(modelOptions ? { options: { ...prior?.options, ...modelOptions } } : {}),
            ...omgInputConfig(model),
          }];
        })),
      },
    },
  };
  writeOpenCodeConfig(path, { ...current, provider });
}
