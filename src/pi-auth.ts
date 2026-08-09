// Provider credentials for the "pi" agent kind.
//
// pi is the one agent whose sign-in we can drive entirely in-process. Every
// other kind shells out to a vendor CLI and scrapes its stdout for a URL and a
// device code (see coding-agents.ts). pi has no `pi login` subcommand at all —
// its login lives inside the interactive TUI — so that approach was never
// available, which is why pi shipped with no sign-in and an ANTHROPIC_API_KEY
// note instead.
//
// But pi's credential layer is a library we already bundle. `pi-ai` exposes one
// provider object per backend, each carrying its own `auth.oauth.login()` /
// `auth.apiKey.login()` driven by callbacks rather than a terminal. We call
// those directly and feed the events straight into the same device-code UI the
// other providers use. No subprocess, no output parsing.
//
// Storage is pi's own: a flat { [providerId]: Credential } map at
// ~/.pi/agent/auth.json (PI_CODING_AGENT_DIR overrides the directory). We write
// it through pi's AuthStorage so the file lock, 0600 mode, and refresh-token
// rotation stay owned by the code that also reads it.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/** Providers pi can sign into from our UI, in the order the UI lists them. */
export const PI_AUTH_PROVIDER_IDS = ["anthropic", "openai-codex", "opencode"] as const;
export type PiAuthProviderId = (typeof PI_AUTH_PROVIDER_IDS)[number];

export type PiAuthMethod = "oauth" | "api-key";

export type PiProviderInfo = {
  id: PiAuthProviderId;
  label: string;
  /** How the user connects it: a browser device code, or pasting a key. */
  method: PiAuthMethod;
  connected: boolean;
  /** Set when a key is present but came from the environment, not our store. */
  fromEnv?: boolean;
};

type PiProviderSpec = {
  id: PiAuthProviderId;
  label: string;
  method: PiAuthMethod;
  /** Subpath export of pi-ai holding the provider factory. */
  module: string;
  factory: string;
  /** Env vars pi itself resolves, so a key set there already counts as auth. */
  envKeys: string[];
};

const PI_PROVIDER_SPECS: Record<PiAuthProviderId, PiProviderSpec> = {
  // pi's default provider, and the only one it could reach before this. Listed
  // first because an unprefixed model id (sonnet, opus) belongs to it.
  anthropic: {
    id: "anthropic",
    label: "Claude (Pro/Max)",
    method: "oauth",
    module: "@earendil-works/pi-ai/providers/anthropic.js",
    factory: "anthropicProvider",
    envKeys: ["ANTHROPIC_API_KEY"],
  },
  "openai-codex": {
    id: "openai-codex",
    label: "ChatGPT (Codex)",
    method: "oauth",
    module: "@earendil-works/pi-ai/providers/openai-codex.js",
    factory: "openaiCodexProvider",
    envKeys: [],
  },
  opencode: {
    id: "opencode",
    label: "OpenCode Zen",
    method: "api-key",
    module: "@earendil-works/pi-ai/providers/opencode.js",
    factory: "opencodeProvider",
    envKeys: ["OPENCODE_API_KEY"],
  },
};

export function piProviderLabel(id: PiAuthProviderId): string {
  return PI_PROVIDER_SPECS[id].label;
}

export function piProviderMethod(id: PiAuthProviderId): PiAuthMethod {
  return PI_PROVIDER_SPECS[id].method;
}

export function isPiAuthProviderId(value: string): value is PiAuthProviderId {
  return (PI_AUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

/** pi's config dir, matching pi's own getAgentDir(). */
export function piAgentDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR?.trim();
  if (override) {
    return override.startsWith("~")
      ? join(process.env.HOME ?? homedir(), override.slice(1))
      : override;
  }
  return join(process.env.HOME ?? homedir(), ".pi", "agent");
}

export function piAuthPath(): string {
  return join(piAgentDir(), "auth.json");
}

// biome-ignore lint: pi's Credential union is owned by pi-ai; we only ever read
// the two discriminant fields below and hand the rest back untouched.
type PiCredential = any;

/**
 * Read the whole credential map. pi creates this file as `{}` on its first run,
 * so its mere existence proves nothing — only a populated entry does.
 */
export function readPiCredentials(): Record<string, PiCredential> {
  const file = piAuthPath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** A credential counts as connected only when it carries a usable secret. */
function credentialIsUsable(credential: PiCredential): boolean {
  if (!credential || typeof credential !== "object") return false;
  if (credential.type === "oauth") return typeof credential.refresh === "string" && !!credential.refresh;
  if (credential.type === "api_key") return typeof credential.key === "string" && !!credential.key;
  return false;
}

function providerEnvKey(spec: PiProviderSpec): boolean {
  return spec.envKeys.some((name) => !!process.env[name]?.trim());
}

/**
 * pi's other credential source: an `apiKey` pinned per provider in
 * ~/.pi/agent/models.json (a literal, a `$ENV_VAR` interpolation, or a
 * `!command`). Users who configured pi by hand before it had a sign-in did it
 * here, and ignoring it would demote a working agent to "Needs setup" and drop
 * it out of the composer entirely.
 */
function providerKeyInModelsConfig(id: PiAuthProviderId): boolean {
  try {
    const raw = readFileSync(join(piAgentDir(), "models.json"), "utf8");
    const config = JSON.parse(raw) as {
      providers?: Record<string, { apiKey?: unknown; oauth?: unknown } | null>;
    };
    const provider = config?.providers?.[id];
    if (!provider || typeof provider !== "object") return false;
    return (typeof provider.apiKey === "string" && !!provider.apiKey.trim()) || !!provider.oauth;
  } catch {
    return false;
  }
}

/** Provider rows for the settings UI: label, how to connect, and current state. */
export function piAuthProviders(): PiProviderInfo[] {
  const credentials = readPiCredentials();
  return PI_AUTH_PROVIDER_IDS.map((id) => {
    const spec = PI_PROVIDER_SPECS[id];
    const stored = credentialIsUsable(credentials[id]);
    // Anything we did not store ourselves is still real auth, but it is not
    // ours to disconnect — the UI hides the delete button for it.
    const external = !stored && (providerEnvKey(spec) || providerKeyInModelsConfig(id));
    return {
      id,
      label: spec.label,
      method: spec.method,
      connected: stored || external,
      ...(external ? { fromEnv: true } : {}),
    };
  });
}

/**
 * True when pi can reach at least one model. A bare ~/.pi/agent/auth.json no
 * longer counts — that file exists as `{}` on every box pi has ever started on,
 * which is what used to make pi report "Ready" with nothing configured.
 */
export function hasPiProviderAuth(): boolean {
  return piAuthProviders().some((provider) => provider.connected);
}

// biome-ignore lint: pi-ai's Provider type is generic over its API shape; we
// only touch `auth`, and importing the concrete type would pin us to one.
async function loadPiProvider(id: PiAuthProviderId): Promise<any> {
  const spec = PI_PROVIDER_SPECS[id];
  let mod: Record<string, unknown>;
  try {
    mod = (await import(spec.module)) as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `pi's ${spec.label} provider is unavailable — reinstall pi with \`OMG_INSTALL_PI=1 omg setup\` (${
        e instanceof Error ? e.message : String(e)
      })`,
    );
  }
  const factory = mod[spec.factory];
  if (typeof factory !== "function") throw new Error(`pi-ai is missing ${spec.factory}`);
  return (factory as () => unknown)();
}

// pi guards auth.json with proper-lockfile, whose lock IS a directory at
// `<file>.lock` created by mkdir — an atomic operation, and the whole protocol.
// Reimplementing that here is a handful of lines and interoperates exactly,
// which matters more than it sounds: OAuth refresh tokens are single-use, so a
// refresh that lands between our read and our write is not merely lost, it
// leaves a rotated token that no longer works. Taking pi's own lock makes that
// interleaving impossible rather than merely unlikely.
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 100;
const LOCK_MAX_ATTEMPTS = 50;

// Waiting is async on purpose. This runs inside the serve process, and a
// sleepSync retry loop would freeze every other request — including unrelated
// ones — for as long as another process held the lock.
async function acquirePiAuthLock(): Promise<() => void> {
  const lockPath = `${piAuthPath()}.lock`;
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      mkdirSync(lockPath);
      return () => {
        try {
          rmSync(lockPath, { recursive: true, force: true });
        } catch {}
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
      // A holder that died without releasing would block every future write,
      // so an untouched lock past the staleness window is reclaimed — the same
      // rule, and the same window, proper-lockfile itself applies.
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {}
      await Bun.sleep(LOCK_RETRY_MS);
    }
  }
  throw new Error("pi's credential file is locked by another process — try again");
}

/**
 * Merge one entry into pi's auth.json, under pi's own lock.
 *
 * We do the read-modify-write ourselves rather than calling pi's AuthStorage:
 * that class is not on the package's export map (only `readStoredCredential`
 * is), and reaching past the map to a deep internal path is exactly what
 * pi-package-pin.test.ts exists to stop. The file format is a documented flat
 * map, so the only thing worth borrowing is the lock. The write still goes
 * through a temp file and a rename, so a reader that ignores the lock sees the
 * old file or the new one, never a half-written one.
 */
async function writePiCredential(
  id: PiAuthProviderId,
  credential: PiCredential | null,
): Promise<void> {
  const dir = piAgentDir();
  const file = piAuthPath();
  mkdirSync(dir, { recursive: true });
  const release = await acquirePiAuthLock();
  const tmp = join(dir, `.auth.json.${randomUUID()}.tmp`);
  try {
    const data = readPiCredentials();
    if (credential === null) delete data[id];
    else data[id] = credential;
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {}
    throw e;
  } finally {
    release();
  }
}

async function savePiCredential(id: PiAuthProviderId, credential: PiCredential): Promise<void> {
  await writePiCredential(id, credential);
}

export async function deletePiCredential(id: PiAuthProviderId): Promise<void> {
  await writePiCredential(id, null);
}

/** What an in-flight pi login reports back while the user completes it. */
export type PiLoginEvent =
  | { type: "device_code"; userCode: string; verificationUri: string }
  | { type: "auth_url"; url: string }
  /** The provider wants the code the user was shown after approving. */
  | { type: "needs_code" };

export type PiLoginHandle = {
  /** Resolves when the credential is stored; rejects on failure or cancel. */
  done: Promise<void>;
  cancel: () => void;
  /** Answer a pending `needs_code`. False when nothing is waiting for one. */
  submitCode: (code: string) => boolean;
};

/**
 * Start an OAuth login for a pi provider.
 *
 * The two flows pi-ai offers map onto sign-in shapes our UI already renders:
 *
 *  - OpenAI Codex asks which method to use. We always answer "device code".
 *    Its browser alternative listens on localhost:1455, and the browser
 *    finishing the login is usually not on the machine running this server, so
 *    that callback would be delivered to the wrong host entirely.
 *  - Anthropic opens a URL and then waits for the code the user is shown
 *    afterwards, which is the paste-a-code flow the Claude CLI login already
 *    uses here — surfaced as `needs_code` and answered by `submitCode`.
 */
export function startPiOAuthLogin(
  id: PiAuthProviderId,
  onEvent: (event: PiLoginEvent) => void,
): PiLoginHandle {
  const controller = new AbortController();
  let resolveCode: ((code: string) => void) | null = null;
  const done = (async () => {
    const provider = await loadPiProvider(id);
    const oauth = provider?.auth?.oauth;
    if (!oauth) throw new Error(`${piProviderLabel(id)} does not support browser sign-in`);
    const credential = await oauth.login({
      signal: controller.signal,
      async prompt(prompt: { type: string; message?: string; signal?: AbortSignal }) {
        if (prompt.type === "select") return "device_code";
        if (prompt.type === "manual_code" || prompt.type === "text") {
          onEvent({ type: "needs_code" });
          return await new Promise<string>((resolve, reject) => {
            resolveCode = (code) => {
              resolveCode = null;
              resolve(code);
            };
            const abort = () => {
              resolveCode = null;
              reject(new Error("Login cancelled"));
            };
            // Either the whole login or just this prompt can be called off —
            // codex aborts a pending prompt when its callback wins the race.
            controller.signal.addEventListener("abort", abort, { once: true });
            prompt.signal?.addEventListener("abort", abort, { once: true });
          });
        }
        // Anything else means pi-ai changed its flow under us. Fail loudly
        // rather than answer a question we did not understand.
        throw new Error(`${piProviderLabel(id)} sign-in needs input we cannot supply here`);
      },
      notify(event: { type: string; [key: string]: unknown }) {
        if (event.type === "device_code") {
          onEvent({
            type: "device_code",
            userCode: String(event.userCode ?? ""),
            verificationUri: String(event.verificationUri ?? ""),
          });
        } else if (event.type === "auth_url") {
          onEvent({ type: "auth_url", url: String(event.url ?? "") });
        }
      },
    });
    await savePiCredential(id, credential);
  })();
  return {
    done,
    cancel: () => controller.abort(),
    submitCode: (code: string) => {
      if (!resolveCode) return false;
      resolveCode(code);
      return true;
    },
  };
}

/** Store an API key for a pi provider that authenticates with one. */
export async function setPiProviderApiKey(id: PiAuthProviderId, key: string): Promise<void> {
  const value = key.trim();
  if (!value) throw new Error(`Enter your ${piProviderLabel(id)} API key`);
  if (piProviderMethod(id) !== "api-key") {
    throw new Error(`${piProviderLabel(id)} signs in through your browser, not an API key`);
  }
  await savePiCredential(id, { type: "api_key", key: value });
}
