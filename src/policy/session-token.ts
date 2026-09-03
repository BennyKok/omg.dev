// The per-session secret that lets a session claim its own id at the shared
// MCP endpoints.
//
// Agents are registered against `/mcp?session=<id>`. Any process on the box
// can put any id in that query string, which is fine for one owner and not
// for a team: a restricted session could claim an owner session's id and
// inherit its tools. The fix is a token only the serve process can mint and
// only the session it was minted for is handed at launch.
//
// Derived, not stored: HMAC(box secret, session id). The registry row needs
// no new column, a serve restart can verify a token it did not mint, and the
// box secret is one file under the data dir. Rows created before this landed
// carry no `mcpTokenRequired` flag and are still accepted on the bare query
// string, so an upgrade does not downgrade running sessions to anonymous.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../config.ts";

export const SESSION_TOKEN_HEADER = "x-omg-session-token";

let cached: { path: string; secret: string } | null = null;

function secretPath(): string {
  return join(PATHS.data, "session-secret");
}

function boxSecret(): string {
  const path = secretPath();
  if (cached?.path === path) return cached.secret;
  let secret = "";
  try {
    if (existsSync(path)) secret = readFileSync(path, "utf8").trim();
  } catch {}
  if (!secret) {
    secret = randomBytes(32).toString("base64url");
    mkdirSync(PATHS.data, { recursive: true });
    writeFileSync(path, secret);
    try {
      chmodSync(path, 0o600);
    } catch {}
  }
  cached = { path, secret };
  return secret;
}

/** The token a session presents to speak as `sessionId`. */
export function sessionToken(sessionId: string): string {
  return createHmac("sha256", boxSecret()).update(sessionId).digest("base64url");
}

export function verifySessionToken(sessionId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(sessionToken(sessionId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Test seam: forget the cached secret so a repointed data dir mints a new one. */
export function resetSessionSecretForTests(): void {
  cached = null;
}
