import {
  chmodSync,
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

// Claude Code stores OAuth credentials in ~/.claude/.credentials.json on
// Linux, but in the login Keychain (service "Claude Code-credentials") on
// macOS — same JSON blob either way. Every reader goes through here so the
// darwin fallback exists exactly once.
// ponytail: 60s cache so dashboard polls don't shell out to `security` each time.

type ClaudeOauth = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
};
type ClaudeCreds = { claudeAiOauth?: ClaudeOauth };

let cached: { record: ClaudeOauth | null; at: number } | null = null;
const TTL_MS = 60_000;

// Claude Code's own OAuth client. Access tokens live ~8h; the CLI silently
// refreshes them whenever it runs. LFG reads the same file without running the
// CLI, so for an account that hasn't started a session lately the stored token
// is simply expired — every direct call (the usage endpoint) then 401s.
const CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_TOKEN_ENDPOINT = "https://console.anthropic.com/v1/oauth/token";
// Refresh a little early: a token that expires mid-flight is a wasted 401.
const EXPIRY_SKEW_MS = 60_000;

export const CLAUDE_PLATFORM_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
] as const;

function defaultConfigDir(): string {
  return join(process.env.HOME ?? homedir(), ".claude");
}

function readCredsFile(configDir = defaultConfigDir()): ClaudeCreds | null {
  try {
    return JSON.parse(
      readFileSync(
        join(configDir, ".credentials.json"),
        "utf8",
      ),
    ) as ClaudeCreds;
  } catch {
    return null;
  }
}

function readCredsKeychain(): ClaudeCreds | null {
  if (process.platform !== "darwin") return null;
  try {
    const proc = Bun.spawnSync(
      ["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { stdout: "pipe", stderr: "ignore" },
    );
    if (proc.exitCode !== 0) return null;
    return JSON.parse(proc.stdout.toString().trim()) as ClaudeCreds;
  } catch {
    return null;
  }
}

/**
 * Drop the Keychain cache. Test seam: the 60s TTL is process-wide, so without
 * this a token read by one test stays visible to the next.
 */
export function resetClaudeCredsCacheForTests(): void {
  cached = null;
}

/**
 * Claude subscription OAuth access token, or null when not signed in.
 *
 * `readKeychain` is injectable for tests only. Unlike the credentials file, the
 * Keychain is not scoped to $HOME, so a test that points HOME at an empty temp
 * directory still sees the developer's real login and cannot assert a miss.
 */
export function claudeOauthToken(
  configDir?: string,
  readKeychain: () => ClaudeCreds | null = readCredsKeychain,
): string | null {
  return claudeOauthRecord(configDir, readKeychain)?.accessToken ?? null;
}

/**
 * The whole stored OAuth record for an account, or null when nothing is stored.
 *
 * `claudeOauthToken` is this, narrowed to the access token. Callers that must
 * tell "signed in" from "sign-in is dead" need the expiry and the refresh token
 * too, and reading the file twice through two slightly different code paths is
 * how those two answers drift apart.
 */
export function claudeOauthRecord(
  configDir?: string,
  readKeychain: () => ClaudeCreds | null = readCredsKeychain,
): ClaudeOauth | null {
  // The Linux credentials file is cheap to read and can appear while LFG is
  // running after a browser login. Read it before the Keychain cache so a
  // completed first-run connection is visible on the very next status poll.
  const fromFile = readCredsFile(configDir)?.claudeAiOauth ?? null;
  if (fromFile?.accessToken) return fromFile;
  // Custom config directories are intentionally file-backed. Falling through
  // to the one machine-wide Keychain entry would make every isolated account
  // resolve to the same login on macOS.
  if (configDir && configDir !== defaultConfigDir()) return null;
  if (process.platform !== "darwin") return null;

  if (cached && Date.now() - cached.at < TTL_MS) return cached.record;
  const creds = readKeychain();
  const record = creds?.claudeAiOauth?.accessToken ? creds.claudeAiOauth : null;
  cached = { record, at: Date.now() };
  return record;
}

// A refresh token that Anthropic has rejected is dead for good, but nothing in
// the credential record says so — a revoked token and a working one look
// identical on disk. Without this memory every poll re-presents the same dead
// token, which is both useless and the thing that trips reuse detection on a
// rotating grant. Store only a fingerprint; the secret never lands here.
type RefreshRejection = { fingerprint: string; at: number; error: string };

function refreshStatePath(configDir: string): string {
  return join(configDir, ".credentials.lfg-refresh.json");
}

function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function readRefreshRejection(configDir: string): RefreshRejection | null {
  try {
    const parsed = JSON.parse(readFileSync(refreshStatePath(configDir), "utf8"));
    return typeof parsed?.fingerprint === "string" ? (parsed as RefreshRejection) : null;
  } catch {
    return null;
  }
}

/** True when Anthropic already refused this exact refresh token. */
function refreshTokenWasRejected(configDir: string, refreshToken?: string): boolean {
  if (!refreshToken) return false;
  return readRefreshRejection(configDir)?.fingerprint === tokenFingerprint(refreshToken);
}

function recordRefreshRejection(configDir: string, refreshToken: string, error: string): void {
  const state: RefreshRejection = {
    fingerprint: tokenFingerprint(refreshToken),
    at: Date.now(),
    error: error.slice(0, 500),
  };
  try {
    writeFileSync(refreshStatePath(configDir), JSON.stringify(state, null, 2) + "\n", {
      mode: 0o600,
    });
  } catch {
    /* best effort: the retry guard is an optimisation, not correctness */
  }
}

function clearRefreshRejection(configDir: string): void {
  try {
    rmSync(refreshStatePath(configDir), { force: true });
  } catch {
    /* best effort */
  }
}

/**
 * Only a definitive "this grant is gone" answer may be remembered. A 500, a
 * timeout, or a proxy error says nothing about the token, and recording one
 * would strand a working account behind a permanent Reconnect badge.
 */
function isDefinitiveGrantRejection(status: number, body: string): boolean {
  if (status !== 400 && status !== 401) return false;
  return /invalid_grant|invalid_request/i.test(body);
}

// The rotated refresh token is single-use, so exactly one refresh may be in
// flight per account. `refreshing` covers this process; the lock file covers
// the others. Both are needed: `serve`, `mcp`, and one `aisdk-session` per
// running agent are separate processes over one ~/.claude.
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_POLL_MS = 100;

function lockPath(configDir: string): string {
  return join(configDir, ".credentials.json.lfg-lock");
}

/**
 * Exclusive create, reclaiming a lock whose owner died before releasing it.
 *
 * "held" and "unavailable" are different answers. Held means another process is
 * mid-refresh and waiting for its result is right. Unavailable means this
 * filesystem will not give us a lock at all, and waiting would stall every call
 * for the full timeout and still refresh nothing.
 */
type LockAttempt = { fd: number } | "held" | "unavailable";

function acquireCredentialLock(configDir: string): LockAttempt {
  const path = lockPath(configDir);
  try {
    return { fd: openSync(path, "wx", 0o600) };
  } catch {
    try {
      const age = Date.now() - statSync(path).mtimeMs;
      if (age > LOCK_STALE_MS) {
        rmSync(path, { force: true });
        return { fd: openSync(path, "wx", 0o600) };
      }
      return "held";
    } catch {
      // The lock file is not there, so the create failed for its own reason: a
      // read-only or missing directory. Refresh unlocked rather than stall.
      return "unavailable";
    }
  }
}

function releaseCredentialLock(fd: number, configDir: string): void {
  try {
    closeSync(fd);
  } catch {
    /* already closed */
  }
  try {
    rmSync(lockPath(configDir), { force: true });
  } catch {
    /* already gone */
  }
}

function needsRefresh(oauth: ClaudeOauth): boolean {
  const expiresAt = oauth.expiresAt;
  return typeof expiresAt === "number" && expiresAt - EXPIRY_SKEW_MS <= Date.now();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for whichever process holds the lock to publish its new token.
 *
 * Racing it would present the same rotating token twice, so the loser waits and
 * reads the winner's result instead. Returns null on timeout, and the caller
 * falls back to the stored token.
 */
async function awaitForeignRefresh(configDir: string): Promise<string | null> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(LOCK_POLL_MS);
    const oauth = readCredsFile(configDir)?.claudeAiOauth;
    if (oauth?.accessToken && !needsRefresh(oauth)) return oauth.accessToken;
  }
  return null;
}

/**
 * Whether a stored sign-in can still be used without the browser.
 *
 * A stored access token expires in about eight hours, and the Claude CLI renews
 * it from the refresh token whenever it runs — so an expired access token alone
 * is normal and says nothing. A record that can no longer be renewed needs the
 * user to sign in again, and the UI has to say so. That is either a record with
 * no refresh token at all, or one whose refresh token Anthropic has rejected.
 */
export function claudeSignInIsDead(
  configDir?: string,
  readKeychain: () => ClaudeCreds | null = readCredsKeychain,
): boolean {
  const record = claudeOauthRecord(configDir, readKeychain);
  if (!record?.accessToken) return false;
  if (record.refreshToken) {
    return refreshTokenWasRejected(configDir ?? defaultConfigDir(), record.refreshToken);
  }
  return typeof record.expiresAt === "number" && record.expiresAt <= Date.now();
}

// One refresh per config dir at a time. The usage endpoint is polled from
// several places at once, and a rotated refresh token is single-use: two
// concurrent refreshes would race, and the loser would persist a token the
// server has already invalidated.
const refreshing = new Map<string, Promise<string | null>>();

async function refreshFileToken(configDir: string, creds: ClaudeCreds): Promise<string | null> {
  const oauth = creds.claudeAiOauth;
  if (!oauth?.refreshToken) return null;
  try {
    const r = await fetch(CLAUDE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: oauth.refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      if (isDefinitiveGrantRejection(r.status, body)) {
        recordRefreshRejection(configDir, oauth.refreshToken, body);
      }
      return null;
    }
    const payload = (await r.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!payload.access_token) return null;
    const next: ClaudeCreds = {
      ...creds,
      claudeAiOauth: {
        ...oauth,
        accessToken: payload.access_token,
        // The server rotates the refresh token. Persist the new one or the
        // next refresh presents a spent credential.
        refreshToken: payload.refresh_token ?? oauth.refreshToken,
        expiresAt:
          typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
            ? Date.now() + payload.expires_in * 1000
            : oauth.expiresAt,
      },
    };
    // Write through a temp file in the same directory: a torn write here costs
    // the account its login, and rename is atomic within one filesystem.
    const target = join(configDir, ".credentials.json");
    const tmp = `${target}.lfg-${process.pid}.tmp`;
    await Bun.write(tmp, JSON.stringify(next, null, 2) + "\n");
    chmodSync(tmp, 0o600);
    renameSync(tmp, target);
    // This grant works, so any remembered rejection belonged to an older token.
    clearRefreshRejection(configDir);
    return payload.access_token;
  } catch {
    return null;
  }
}

/**
 * Refresh under the cross-process lock, or wait for whoever already holds it.
 *
 * The re-read after acquiring matters as much as the lock: by the time we get
 * in, the previous holder may already have written a token that is good, and
 * refreshing again would burn a rotation for nothing.
 */
async function refreshUnderLock(configDir: string): Promise<string | null> {
  const lock = acquireCredentialLock(configDir);
  if (lock === "held") return awaitForeignRefresh(configDir);
  try {
    const fresh = readCredsFile(configDir);
    const oauth = fresh?.claudeAiOauth;
    if (!oauth?.refreshToken) return null;
    if (!needsRefresh(oauth)) return oauth.accessToken ?? null;
    if (refreshTokenWasRejected(configDir, oauth.refreshToken)) return null;
    return await refreshFileToken(configDir, fresh!);
  } finally {
    if (lock !== "unavailable") releaseCredentialLock(lock.fd, configDir);
  }
}

/**
 * Claude subscription access token, refreshed first if the stored one has
 * expired. Prefer this over `claudeOauthToken` for anything that calls
 * Anthropic directly; the sync reader stays for "is this account connected?"
 * checks, which only need a credential to exist.
 *
 * Keychain-backed logins (macOS default account) are left to the CLI — LFG
 * doesn't write the Keychain — so those fall back to the stored token.
 */
export async function claudeAccessToken(configDir?: string): Promise<string | null> {
  const dir = configDir ?? defaultConfigDir();
  const creds = readCredsFile(dir);
  const oauth = creds?.claudeAiOauth;
  if (!oauth?.accessToken) return claudeOauthToken(configDir);
  if (!needsRefresh(oauth)) return oauth.accessToken;
  // Anthropic already refused this exact token. Asking again cannot succeed,
  // and each retry is another reuse hit against an already-dead grant.
  if (refreshTokenWasRejected(dir, oauth.refreshToken)) return oauth.accessToken;
  const inflight = refreshing.get(dir);
  if (inflight) return (await inflight) ?? oauth.accessToken;
  const run = refreshUnderLock(dir).finally(() => refreshing.delete(dir));
  refreshing.set(dir, run);
  // Fall back to the expired token rather than nothing: the caller's own error
  // path ("sign-in expired") is a better message than "not signed in".
  return (await run) ?? oauth.accessToken;
}

/**
 * Build the full environment for a Claude subprocess owned by a connected
 * Claude account. The Agent SDK treats `env` as a complete replacement, so
 * preserve every unrelated variable while removing the platform proxy/auth
 * variables that otherwise override ~/.claude/.credentials.json.
 */
export function claudeAccountEnv(
  source: NodeJS.ProcessEnv = process.env,
  accountConnected = claudeOauthToken() !== null,
  configDir?: string,
): Record<string, string> | undefined {
  if (!accountConnected) return undefined;
  const blocked = new Set<string>(CLAUDE_PLATFORM_ENV_KEYS);
  const env = Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !blocked.has(entry[0]),
    ),
  );
  if (configDir && configDir !== defaultConfigDir()) {
    env.CLAUDE_CONFIG_DIR = configDir;
  }
  return env;
}
