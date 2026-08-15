// Provider credentials for the "opencode" agent kind.
//
// OpenCode's paid providers — the Go plan above all — were reachable only by
// running `opencode auth login` in a terminal. That is a real gap in a UI whose
// whole job is to get an agent runnable: the settings page could tell you the
// command but not run it for you, and on a hosted box the person reading that
// sentence often has no terminal to run it in. It also left the page unable to
// answer the more basic question of *which* provider this box is signed into.
//
// The credential store is a documented flat map at
// ~/.local/share/opencode/auth.json (XDG_DATA_HOME moves the parent), keyed by
// provider id — `opencode-go`, `opencode`, `openai`, `fugu`, … — whose entries
// are either `{type:"api", key}` or an OAuth record with `access`/`refresh`.
// The Go plan authenticates with a pasted key, so for that provider the whole
// login is a write to this file, which is what this module does.
//
// We deliberately do NOT own the OAuth-shaped entries: `opencode auth login`
// still writes those, and we only read them (to report what is connected) or
// delete them wholesale. Anything we do not recognise is preserved untouched on
// every write.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/** Providers we can connect from the UI, in the order the UI lists them. */
export const OPENCODE_AUTH_PROVIDER_IDS = ["opencode-go", "opencode"] as const;
export type OpencodeAuthProviderId = (typeof OPENCODE_AUTH_PROVIDER_IDS)[number];

export type OpencodeProviderInfo = {
  id: string;
  label: string;
  /** Every provider we can connect here authenticates with a pasted key. */
  method: "oauth" | "api-key";
  connected: boolean;
  /** Set when the credential is not ours to delete (env var, or CLI OAuth). */
  fromEnv?: boolean;
  /** Overrides the UI's "From the environment" caption when that is not true. */
  detail?: string;
};

type OpencodeProviderSpec = {
  id: OpencodeAuthProviderId;
  label: string;
  /** Env vars OpenCode itself resolves, so a key set there already counts. */
  envKeys: string[];
  /** Where the user gets the key, shown in the connect dialog. */
  keyUrl: string;
};

const OPENCODE_PROVIDER_SPECS: Record<OpencodeAuthProviderId, OpencodeProviderSpec> = {
  // The subscription plan. Listed first because it is the one people are
  // actually paying for, and the reason this module exists.
  "opencode-go": {
    id: "opencode-go",
    label: "OpenCode Go",
    envKeys: [],
    keyUrl: "https://opencode.ai/auth",
  },
  // Zen's free tier needs no credential at all; a key here buys its paid
  // models. OPENCODE_API_KEY is the env var OpenCode reads for it.
  opencode: {
    id: "opencode",
    label: "OpenCode Zen",
    envKeys: ["OPENCODE_API_KEY"],
    keyUrl: "https://opencode.ai/zen",
  },
};

export function isOpencodeAuthProviderId(value: string): value is OpencodeAuthProviderId {
  return (OPENCODE_AUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

export function opencodeProviderLabel(id: string): string {
  return isOpencodeAuthProviderId(id) ? OPENCODE_PROVIDER_SPECS[id].label : id;
}

export function opencodeProviderKeyUrl(id: string): string | null {
  return isOpencodeAuthProviderId(id) ? OPENCODE_PROVIDER_SPECS[id].keyUrl : null;
}

function userHome(): string {
  return process.env.HOME ?? homedir();
}

/** OpenCode's credential store, honouring the XDG override it reads itself. */
export function opencodeAuthPath(): string {
  const xdg = process.env.XDG_DATA_HOME?.trim();
  return join(xdg ? xdg : join(userHome(), ".local", "share"), "opencode", "auth.json");
}

// biome-ignore lint: the entry union is OpenCode's, not ours; we read two
// discriminant fields and hand every other key back untouched.
type OpencodeCredential = any;

/** The whole credential map, or `{}` when it is missing or unreadable. */
export function readOpencodeCredentials(): Record<string, OpencodeCredential> {
  try {
    const parsed = JSON.parse(readFileSync(opencodeAuthPath(), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** A credential counts only when it carries a secret we could actually send. */
function credentialIsUsable(entry: OpencodeCredential): boolean {
  if (!entry || typeof entry !== "object") return false;
  return [entry.key, entry.access, entry.refresh].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

/**
 * Provider ids OpenCode holds a usable credential for.
 *
 * An empty or missing file means the only models this box can reach are
 * OpenCode Zen's credential-free tier — `opencode models` lists exactly those
 * and nothing else, which is what makes this the right signal for gating the
 * picker.
 */
export function opencodeAuthProviderIds(): string[] {
  return Object.entries(readOpencodeCredentials())
    .filter(([, entry]) => credentialIsUsable(entry))
    .map(([id]) => id);
}

export function hasOpenCodeAccountAuth(): boolean {
  if (process.env.OPENCODE_API_KEY?.trim()) return true;
  return opencodeAuthProviderIds().length > 0;
}

/**
 * Provider rows for the settings UI.
 *
 * The two connectable specs come first and always render, so "connect Go" is
 * reachable on a box with no auth.json at all. Anything else already in the
 * file — a ChatGPT OAuth written by `opencode auth login`, say — follows as a
 * connected row, because "OpenCode is signed in" was never a useful answer to
 * *which account is this*. Those rows carry `fromEnv` so the UI does not offer
 * to delete a credential whose login flow lives in the CLI and not here.
 */
export function opencodeAuthProviders(): OpencodeProviderInfo[] {
  const credentials = readOpencodeCredentials();
  const rows: OpencodeProviderInfo[] = OPENCODE_AUTH_PROVIDER_IDS.map((id) => {
    const spec = OPENCODE_PROVIDER_SPECS[id];
    const stored = credentialIsUsable(credentials[id]);
    const fromEnv = !stored && spec.envKeys.some((name) => !!process.env[name]?.trim());
    return {
      id,
      label: spec.label,
      method: "api-key" as const,
      connected: stored || fromEnv,
      ...(fromEnv ? { fromEnv: true } : {}),
    };
  });
  for (const [id, entry] of Object.entries(credentials)) {
    if (isOpencodeAuthProviderId(id) || !credentialIsUsable(entry)) continue;
    rows.push({
      id,
      label: id,
      method: entry?.type === "api" ? "api-key" : "oauth",
      connected: true,
      fromEnv: true,
      detail: "Signed in with `opencode auth login`",
    });
  }
  return rows;
}

/**
 * Merge one entry into auth.json without disturbing the others.
 *
 * OpenCode takes no lock on this file, so there is none to interoperate with;
 * the write still goes through a temp file and a rename so a concurrent reader
 * (the CLI, mid-session) sees the old map or the new one and never a truncated
 * one. Mode 0600 matches what OpenCode itself creates — this file holds bearer
 * keys, and a rename would otherwise carry the default umask onto it.
 */
function writeOpencodeCredential(id: string, credential: OpencodeCredential | null): void {
  const file = opencodeAuthPath();
  const dir = join(file, "..");
  mkdirSync(dir, { recursive: true });
  const data = readOpencodeCredentials();
  if (credential === null) delete data[id];
  else data[id] = credential;
  const tmp = join(dir, `.auth.json.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {}
    throw e;
  }
}

/** Store an API key for an OpenCode provider. */
export function setOpencodeProviderApiKey(id: string, key: string): void {
  const value = key.trim();
  if (!isOpencodeAuthProviderId(id)) throw new Error(`${id} is not an OpenCode provider we can connect`);
  if (!value) throw new Error(`Enter your ${opencodeProviderLabel(id)} API key`);
  writeOpencodeCredential(id, { type: "api", key: value });
}

/** Forget a stored credential. Absent entries are already in the target state. */
export function deleteOpencodeCredential(id: string): void {
  if (!existsSync(opencodeAuthPath())) return;
  writeOpencodeCredential(id, null);
}
