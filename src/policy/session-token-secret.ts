// Session authentication has its own key ring. The old session-secret file
// remains the box key for connector encryption and must never be rotated here.
import { createHash, randomBytes } from "node:crypto";
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../config.ts";

export const SESSION_TOKEN_GRACE_MS = 60 * 60 * 1000;
export type SessionTokenKey = { version: string; secret: string; createdAt: number };
export type SessionTokenKeyRing = {
  schema: 1;
  current: SessionTokenKey;
  previous?: SessionTokenKey & { expiresAt: number };
};

function path(): string { return join(PATHS.data, "session-token-secret"); }
function freshKey(now: number): SessionTokenKey {
  return { version: randomBytes(8).toString("hex"), secret: randomBytes(32).toString("base64url"), createdAt: now };
}
function validKey(value: unknown): value is SessionTokenKey {
  if (!value || typeof value !== "object") return false;
  const key = value as SessionTokenKey;
  return typeof key.version === "string" && /^(legacy|[a-f0-9]{16})$/.test(key.version)
    && typeof key.secret === "string" && key.secret.length > 0 && Number.isFinite(key.createdAt);
}
function read(): SessionTokenKeyRing | null {
  let contents: string;
  try { contents = readFileSync(path(), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Cannot read session-token-secret");
  }
  try {
    const ring = JSON.parse(contents) as SessionTokenKeyRing;
    if (ring.schema !== 1 || !validKey(ring.current)
      || (ring.previous !== undefined && (!validKey(ring.previous) || !Number.isFinite(ring.previous.expiresAt)))) {
      throw new Error();
    }
    return ring;
  } catch {
    // JSON parser errors can echo secret contents. Do not include the cause.
    throw new Error("Invalid session-token-secret; refusing to replace it");
  }
}

function write(ring: SessionTokenKeyRing, createOnly: boolean): void {
  mkdirSync(PATHS.data, { recursive: true });
  const temporary = `${path()}.${process.pid}.${randomBytes(8).toString("hex")}`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    try {
      writeFileSync(fd, JSON.stringify(ring) + "\n");
      fsyncSync(fd);
    } finally { closeSync(fd); }
    if (createOnly) {
      // Publish a complete file without replacing another process's first key.
      try { linkSync(temporary, path()); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } else {
      renameSync(temporary, path());
    }
    const directory = openSync(PATHS.data, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}

/** Read on every mint/verification so another process's rotation takes effect
 * without a service restart. Initialization does not start a grace window.
 */
export function sessionTokenKeyRing(now = Date.now()): SessionTokenKeyRing {
  const existing = read();
  if (existing) return existing;
  let legacy: string | undefined;
  try {
    legacy = readFileSync(join(PATHS.data, "session-secret"), "utf8").trim();
    if (!legacy) throw new Error("Empty legacy box secret; refusing to migrate");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // On upgrade, copy the existing signing material once. Preserve the old
  // unversioned token format until the operator's explicit rotation. New
  // installs start with an independent key and never create the box secret.
  write({ schema: 1, current: legacy ? { version: "legacy", secret: legacy, createdAt: now } : freshKey(now) }, true);
  return read()!;
}

export function sessionTokenSecretStatus(now = Date.now()) {
  const ring = sessionTokenKeyRing(now);
  const describe = (key: SessionTokenKey) => ({ version: key.version, fingerprint: createHash("sha256").update(key.secret).digest("hex").slice(0, 12) });
  return {
    current: describe(ring.current),
    previous: ring.previous ? { ...describe(ring.previous), expiresAt: ring.previous.expiresAt, accepting: now < ring.previous.expiresAt } : null,
  };
}

/** Admin-only local operation. Refuse a second rotation during grace rather
 * than silently invalidating sessions that still use the previous key.
 */
export function rotateSessionTokenSecret(graceMs = SESSION_TOKEN_GRACE_MS, now = Date.now()) {
  if (!Number.isSafeInteger(graceMs) || graceMs < 1000 || graceMs > 24 * 60 * 60 * 1000) {
    throw new Error("Grace must be between 1 second and 24 hours");
  }
  mkdirSync(PATHS.data, { recursive: true });
  const lock = `${path()}.lock`;
  let fd: number;
  try { fd = openSync(lock, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Session-token rotation is locked; check for another rotation before removing session-token-secret.lock");
    throw error;
  }
  try {
    writeFileSync(fd, String(process.pid));
    const ring = sessionTokenKeyRing(now);
    if (ring.previous && now < ring.previous.expiresAt) throw new Error("Previous session-token version is still in its grace period");
    write({ schema: 1, current: freshKey(now), previous: { ...ring.current, expiresAt: now + graceMs } }, false);
    return sessionTokenSecretStatus(now);
  } finally { closeSync(fd); unlinkSync(lock); }
}
