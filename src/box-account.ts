// The omg account this box is paired to.
//
// `omg connect` stores an OAuth credential in ~/.omg/credentials.json whose
// access token carries an `email` claim. A box is paired to exactly one
// account, so an ownerless session can use that account as a last-resort
// attribution source.
//
// This is NOT an authentication claim and must never become one. Nothing is
// authorized by it. It exists only to attribute an otherwise-ownerless session
// when the email is already on the box's roster.
//
// Consequently the token is read for its email claim WITHOUT verifying the
// signature or expiry. An unverified email grants nothing, and an expired token
// still identifies the account that paired the box.
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const BOX_CREDENTIALS_PATH = join(
  process.env.HOME ?? homedir(),
  ".omg",
  "credentials.json",
);

/** Pull the `email` claim out of a JWT payload without throwing. */
export function jwtEmailClaim(token: unknown): string | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    if (!claims || typeof claims !== "object") return null;
    const email = (claims as { email?: unknown }).email;
    if (typeof email !== "string") return null;
    return email.trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

// Cache by file identity so a token refresh or re-pair takes effect without a
// server restart. A stat is cheaper than reading and decoding the token for
// every session creation.
let cached: { key: string; email: string | null } | null = null;

/** The email of the omg account this box is paired to, or null if unpaired. */
export function boxAccountEmail(path: string = BOX_CREDENTIALS_PATH): string | null {
  let key: string;
  try {
    const st = statSync(path);
    key = `${path}:${st.mtimeMs}:${st.size}`;
  } catch {
    cached = null;
    return null;
  }
  if (cached?.key === key) return cached.email;

  let email: string | null = null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { token?: unknown };
    email = jwtEmailClaim(raw?.token);
  } catch {
    email = null;
  }
  cached = { key, email };
  return email;
}

/** Test seam: drop the file cache. */
export function resetBoxAccountCache(): void {
  cached = null;
}
