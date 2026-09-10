import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { cloudApiBaseUrl, loadCloudCredentials } from "./cloud-account.ts";
import { OMG_MODELS } from "./omg-models.ts";

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

/** The guest sets OMG_AI_URL; its preinstalled provider is a fallback marker. */
export function isHostedOmgSandbox(options: OmgProviderOptions = {}): boolean {
  const env = options.env ?? process.env;
  if (env.OMG_AI_URL?.trim().replace(/\/+$/, "").replace(/\/v1$/, "") === GUEST_PROXY) return true;
  const path = options.guestConfigPath ?? "/home/user/.config/opencode/opencode.jsonc";
  try { return !!readConfig(path).provider?.omg; } catch { return false; }
}

export function hasOmgProviderAccess(options: OmgProviderOptions = {}): boolean {
  if (isHostedOmgSandbox(options)) return true;
  return !!loadCloudCredentials(join(options.home ?? homedir(), ".omg", "credentials.json"));
}

/** Merge only our provider. JSONC takes precedence over JSON in OpenCode. */
export function ensureOmgProvider(options: OmgProviderOptions = {}): void {
  if (isHostedOmgSandbox(options)) return;
  const home = options.home ?? homedir();
  const credentials = loadCloudCredentials(join(home, ".omg", "credentials.json"));
  if (!credentials) throw new Error(OMG_SIGN_IN_REQUIRED);
  const env = options.env ?? process.env;
  const dir = join(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), "opencode");
  // Match the existing MCP writer's opencode.json path on a new installation.
  const jsonc = join(dir, "opencode.jsonc");
  const path = existsSync(jsonc) ? jsonc : join(dir, "opencode.json");
  const current = readConfig(path);
  const previous = current.provider?.omg ?? {};
  // The local CLI holds a control-plane OAuth token. Infra does not accept it, so
  // the local route goes through the control-plane CLI gate (control-plane/lib/cli.ts).
  const baseURL = `${cloudApiBaseUrl()}/api/cli/llm/v1`;
  const next = {
    ...current,
    provider: {
      ...current.provider,
      omg: {
        ...previous,
        npm: "@ai-sdk/openai-compatible",
        name: "omg",
        options: { ...previous.options, baseURL, apiKey: credentials.token },
        models: {
          ...previous.models,
          ...Object.fromEntries(OMG_MODELS.map((model) => {
            const id = model.slice("omg/".length);
            return [id, { ...previous.models?.[id], name: id }];
          })),
        },
      },
    },
  };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}
