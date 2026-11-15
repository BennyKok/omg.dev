// Google can sign a person in to Antigravity and still refuse every request
// until they verify the account in a browser (403 PERMISSION_DENIED, reason
// VALIDATION_REQUIRED). `agy` hides that state well: `agy models` still exits
// 0 and lists models, and an ACP prompt answers only "⚠ Verification Required"
// with no link. The one place agy records the verification link is its own
// log, so omg.dev asks agy to write that log to a known file and reads the
// link back from it. omg.dev never calls the Google API itself.
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** The exact text `agy acp` streams as the answer when Google wants a check. */
export const ANTIGRAVITY_VERIFICATION_REPLY = /^\s*⚠?\s*Verification Required\s*$/i;

/**
 * Read Google's verification link from an agy log.
 *
 * Only an https link on accounts.google.com is accepted. The link is shown to
 * the person as a clickable button, so a log line cannot steer them anywhere
 * else.
 */
export function antigravityVerifyUrlFromLog(log: string): string | null {
  if (!/VALIDATION_REQUIRED/.test(log)) return null;
  for (const match of log.matchAll(/"(?:validation_url|url)":\s*"([^"]+)"/g)) {
    const raw = match[1]!.replace(/\\u0026/g, "&");
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" && url.hostname === "accounts.google.com") return url.toString();
    } catch {}
  }
  return null;
}

export type AntigravityAccountState = {
  /** `agy models` worked, so agy holds a Google login. */
  signedIn: boolean;
  /** Set when Google wants the account verified before it serves requests. */
  verifyUrl: string | null;
};

function probeLogDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "lfg", "antigravity-probe");
}

/**
 * Run `agy models` with its log sent to a private file, then read whether
 * Google asked for verification. Async and time-limited, because the status
 * read path must never block the event loop.
 */
export async function probeAntigravityAccount(binary: string, timeoutMs = 15_000): Promise<AntigravityAccountState> {
  const dir = probeLogDir();
  const logFile = join(dir, `models-${randomUUID()}.log`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const proc = Bun.spawn([binary, "--log-file", logFile, "models"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const exitCode = await proc.exited.finally(() => clearTimeout(timer));
    let log = "";
    try { log = readFileSync(logFile, "utf8"); } catch {}
    return { signedIn: exitCode === 0, verifyUrl: exitCode === 0 ? antigravityVerifyUrlFromLog(log) : null };
  } catch {
    return { signedIn: false, verifyUrl: null };
  } finally {
    rmSync(logFile, { force: true });
  }
}
