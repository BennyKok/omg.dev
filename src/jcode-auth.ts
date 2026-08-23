// Provider credentials for the "jcode" agent kind.
//
// jcode is a BYO harness: it signs into Claude and Codex through its own CLI,
// then omg.dev drives that same CLI. The settings page used to print
// `jcode login` and hand the user to a terminal. That is a dead end on a hosted
// box, and it hid the fact that Claude and Codex are two different logins.
//
// jcode already ships the scriptable flow wrappers are supposed to use
// (docs/WRAPPERS.md, OAUTH.md):
//
//   jcode login --provider claude --print-auth-url --json
//   jcode login --provider claude --auth-code <code>
//   jcode login --provider openai --print-auth-url --json
//   jcode login --provider openai --callback-url <url>
//
// Codex is `--provider openai`. There is no `--provider codex` flag.
//
// This module owns the provider ids, the argv, the prompt JSON, and the
// jcode-managed files we may delete. The browser session lifecycle stays in
// coding-agents.ts so the UI keeps one login dialog.

import { existsSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Providers we can connect from the UI, in the order the UI lists them. */
export const JCODE_AUTH_PROVIDER_IDS = ["claude", "openai"] as const;
export type JcodeAuthProviderId = (typeof JCODE_AUTH_PROVIDER_IDS)[number];

export type JcodeProviderInfo = {
  id: JcodeAuthProviderId;
  label: string;
  method: "oauth";
  connected: boolean;
  fromEnv?: boolean;
  detail?: string;
  /**
   * jcode holds a credential for this provider and reports that it cannot be
   * used. Only a new sign-in revives it, and the row has to say so instead of
   * showing a Connected badge over a dead token.
   */
  needsReconnect?: boolean;
};

export type JcodeAuthPrompt = {
  authorizationUrl: string;
  userCode?: string;
  inputKind?: string;
  expiresAtMs?: number;
};

export type JcodeAuthStatusProvider = {
  id?: unknown;
  status?: unknown;
  credential_source?: unknown;
};

export type JcodeAuthStatus = {
  any_available?: unknown;
  providers?: JcodeAuthStatusProvider[];
};

type JcodeProviderSpec = {
  id: JcodeAuthProviderId;
  /** What the settings row and the login dialog call it. */
  label: string;
  /** File jcode writes for a login we started. */
  file: string;
  envKeys: string[];
};

const JCODE_PROVIDER_SPECS: Record<JcodeAuthProviderId, JcodeProviderSpec> = {
  claude: {
    id: "claude",
    label: "Claude",
    file: "auth.json",
    envKeys: ["ANTHROPIC_API_KEY"],
  },
  // ChatGPT / Codex. The CLI flag is `openai`; the product name in this UI is
  // Codex, matching the other coding-agent rows.
  openai: {
    id: "openai",
    label: "Codex",
    file: "openai-auth.json",
    envKeys: ["OPENAI_API_KEY"],
  },
};

export function isJcodeAuthProviderId(value: string): value is JcodeAuthProviderId {
  return (JCODE_AUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

export function jcodeProviderLabel(id: JcodeAuthProviderId): string {
  return JCODE_PROVIDER_SPECS[id].label;
}

export function jcodeCliProviderFlag(id: JcodeAuthProviderId): JcodeAuthProviderId {
  return id;
}

function userHome(): string {
  return process.env.HOME ?? homedir();
}

/** jcode's data dir, honouring the JCODE_HOME override it reads itself. */
export function jcodeDir(): string {
  const override = process.env.JCODE_HOME?.trim();
  if (override) {
    return override.startsWith("~")
      ? join(process.env.HOME ?? homedir(), override.slice(1))
      : override;
  }
  return join(userHome(), ".jcode");
}

export function jcodeCredentialPath(id: JcodeAuthProviderId): string {
  return join(jcodeDir(), JCODE_PROVIDER_SPECS[id].file);
}

export function jcodePendingLoginPath(id: JcodeAuthProviderId): string {
  return join(jcodeDir(), "pending-login", `${id}.json`);
}

function credentialFileLooksUsed(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    return statSync(path).size > 2;
  } catch {
    return true;
  }
}

function sourceLabel(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sourceIsNone(source: string): boolean {
  return source === "" || source === "none";
}

function sourceIsJcodeManaged(source: string): boolean {
  return (
    source === "jcode-managed file" ||
    source === "stored" ||
    source === "app config file"
  );
}

function sourceIsImported(source: string): boolean {
  return /trusted external|local CLI|mixed/i.test(source);
}

function sourceIsEnv(source: string): boolean {
  return /environment/i.test(source);
}

/**
 * Argv that starts a scriptable jcode login and prints one JSON object.
 *
 * `--print-auth-url` writes pending state and exits. The process does not wait
 * for the browser, which is why the UI must complete with `--callback-url` or
 * `--auth-code` instead of scraping a long-lived CLI.
 */
export function jcodeLoginArgv(binary: string, id: JcodeAuthProviderId): string[] {
  return [binary, "--no-update", "login", "--provider", id, "--print-auth-url", "--json"];
}

/**
 * Argv that finishes a scriptable jcode login.
 *
 * Claude accepts a pasted authorization code or the full callback URL. Codex
 * (`openai`) requires `--callback-url` because it validates OAuth state.
 */
export function jcodeCompleteArgv(
  binary: string,
  id: JcodeAuthProviderId,
  input: string,
): string[] {
  const value = input.trim();
  const flag = jcodeCompleteFlag(id, value);
  return [binary, "--no-update", "login", "--provider", id, flag, value];
}

export function jcodeCompleteFlag(
  id: JcodeAuthProviderId,
  input: string,
): "--callback-url" | "--auth-code" {
  if (id === "openai") return "--callback-url";
  const value = input.trim();
  if (/^https?:\/\//i.test(value) || /[?&]code=/.test(value)) return "--callback-url";
  return "--auth-code";
}

/**
 * Read the URL (and optional device code) out of `jcode login --print-auth-url`.
 *
 * `--json` prints one object with `auth_url`. Without `--json`, the URL is the
 * first https:// token on stdout. Either shape is enough for the existing
 * login dialog.
 */
export function parseJcodeAuthPrompt(raw: string): JcodeAuthPrompt | null {
  const cleaned = raw
    .replace(/\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        auth_url?: unknown;
        user_code?: unknown;
        input_kind?: unknown;
        expires_at_ms?: unknown;
      };
      if (typeof parsed.auth_url === "string" && parsed.auth_url.trim()) {
        return {
          authorizationUrl: parsed.auth_url.trim(),
          ...(typeof parsed.user_code === "string" && parsed.user_code
            ? { userCode: parsed.user_code }
            : {}),
          ...(typeof parsed.input_kind === "string" && parsed.input_kind
            ? { inputKind: parsed.input_kind }
            : {}),
          ...(typeof parsed.expires_at_ms === "number"
            ? { expiresAtMs: parsed.expires_at_ms }
            : {}),
        };
      }
    } catch {
      // Keep scanning. A log line that starts with `{` is not the prompt.
    }
  }
  const authorizationUrl = cleaned.match(/https:\/\/[^\s\x07\x1b]+/)?.[0];
  if (!authorizationUrl) return null;
  return { authorizationUrl };
}

export function summarizeJcodeAuthStatus(status: JcodeAuthStatus | null): {
  available: boolean;
  accountConnected: boolean;
} {
  if (!status) return { available: false, accountConnected: false };
  const providers = Array.isArray(status.providers) ? status.providers : [];
  const available =
    status.any_available === true || providers.some((provider) => provider.status === "available");
  const accountConnected = providers.some((provider) => {
    if (provider.status !== "available") return false;
    return !sourceIsNone(sourceLabel(provider.credential_source));
  });
  return { available, accountConnected };
}

function statusForId(
  status: JcodeAuthStatus | null,
  id: JcodeAuthProviderId,
): JcodeAuthStatusProvider | undefined {
  if (!status || !Array.isArray(status.providers)) return undefined;
  return status.providers.find((provider) => provider.id === id);
}

/**
 * Provider rows for the settings UI.
 *
 * Claude and Codex always render, so Connect has somewhere to live on a box
 * that has never signed in. `status` is `jcode auth status --json` when the
 * binary answered; file and env fallbacks cover a missing or older report.
 */
export function jcodeAuthProviders(status: JcodeAuthStatus | null = null): JcodeProviderInfo[] {
  return JCODE_AUTH_PROVIDER_IDS.map((id) => {
    const spec = JCODE_PROVIDER_SPECS[id];
    const reported = statusForId(status, id);
    const source = sourceLabel(reported?.credential_source);
    const reportedAvailable = reported?.status === "available" && !sourceIsNone(source);
    // jcode answered, it holds a credential for this provider, and it says that
    // credential is not usable. That verdict wins: it comes from the CLI that
    // owns the token and just tried to refresh it. `stored` only proves a file
    // exists, so a revoked login would otherwise keep reporting Connected.
    const reportedDead =
      !!reported && !sourceIsNone(source) && reported.status !== "available";
    const stored = credentialFileLooksUsed(jcodeCredentialPath(id));
    const fromEnv = spec.envKeys.some((name) => !!process.env[name]?.trim());
    const imported = reportedAvailable && (sourceIsImported(source) || sourceIsEnv(source));
    const connected = reportedAvailable || (!reportedDead && (stored || fromEnv));
    const ownedHere = stored || (reportedAvailable && sourceIsJcodeManaged(source));
    return {
      id,
      label: spec.label,
      method: "oauth" as const,
      connected,
      ...(reportedDead ? { needsReconnect: true } : {}),
      ...(!ownedHere && connected ? { fromEnv: true } : {}),
      ...(imported && sourceIsImported(source)
        ? { detail: "Imported from another CLI" }
        : {}),
    };
  });
}

/** Forget a jcode-managed login. Imported or env credentials are not ours. */
export function deleteJcodeCredential(id: JcodeAuthProviderId): void {
  if (!isJcodeAuthProviderId(id)) throw new Error(`${id} is not a jcode provider we can disconnect`);
  const path = jcodeCredentialPath(id);
  if (existsSync(path)) rmSync(path);
  clearJcodePendingLogin(id);
}

export function clearJcodePendingLogin(id: JcodeAuthProviderId): void {
  const path = jcodePendingLoginPath(id);
  if (existsSync(path)) rmSync(path);
}
