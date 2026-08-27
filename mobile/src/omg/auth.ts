/**
 * Sign-in and the short-lived app JWT.
 *
 * Deliberately raw `fetch` against better-auth's REST surface instead of
 * pulling in better-auth's browser client. Two reasons:
 *
 *   1. The browser client's whole job is managing a cookie jar the DOM won't
 *      let it touch. React Native's fetch is backed by NSURLSession / OkHttp,
 *      both of which already persist Set-Cookie across requests, so the session
 *      cookie survives without any of that machinery.
 *   2. It keeps three endpoints of surface area instead of a dependency that
 *      assumes `document` and `location`.
 *
 * The server needs NO change for this: /token authenticates with
 * `auth.api.getSession({ headers })`, which reads the same session cookie the
 * platform jar replays. The `bearer` plugin is not enabled on auth.omg.dev and
 * this path does not need it.
 *
 * Cookie persistence caveat: the jar is process-scoped on both platforms and
 * survives app restarts, but a user who clears app data is signed out. That's
 * the same contract as the web app, so it needs no extra recovery path — the
 * OTP flow simply runs again.
 */

import { AUTH_APP_ID, AUTH_ORIGIN, AUTH_REQUEST_ORIGIN } from "./config";

export class OmgAuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OmgAuthError";
    this.status = status;
  }
}

/**
 * Thrown when the server did not confirm the session was revoked. Distinct
 * from OmgAuthError so callers can tell "sign-out failed, the account may
 * still be signed in server-side" apart from an ordinary sign-in failure —
 * the caller must NOT treat this the same as a successful sign-out.
 */
export class SignOutFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignOutFailedError";
  }
}

/**
 * better-auth's own routes are mounted under /api/auth on auth.omg.dev, while
 * the JWT exchange at /token is a first-party route at the root. Mixing the two
 * up is a silent 404, so the prefix lives here once.
 */
const BETTER_AUTH_BASE = "/api/auth";

async function authFetch(path: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${AUTH_ORIGIN}${BETTER_AUTH_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: AUTH_REQUEST_ORIGIN },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OmgAuthError("Couldn't reach omg. Check your connection.", 0);
  }
  const text = await response.text().catch(() => "");
  let data: unknown = {};
  try {
    data = text ? (JSON.parse(text) as unknown) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const message =
      (data as { message?: string; error?: string })?.message ??
      (data as { error?: string })?.error ??
      `Sign-in failed (${response.status})`;
    throw new OmgAuthError(message, response.status);
  }
  return data;
}

/**
 * Ask for a 6-digit code. The server writes the code before it sends the mail,
 * so a slow inbox is not a failed request.
 *
 * Sign-in codes are rate limited per IP (10/hr, 20/day) and the send reports
 * success either way, so callers must never auto-retry this on a silent
 * non-advance — surface the error and let the person decide.
 */
export async function sendSignInCode(email: string): Promise<void> {
  await authFetch("/email-otp/send-verification-otp", {
    email: email.trim().toLowerCase(),
    type: "sign-in",
  });
}

export type SignedInUser = { id: string; email: string; name?: string };

/** Exchange the emailed code for a session cookie held by the platform jar. */
export async function verifySignInCode(
  email: string,
  otp: string,
): Promise<SignedInUser> {
  const data = (await authFetch("/sign-in/email-otp", {
    email: email.trim().toLowerCase(),
    otp: otp.trim(),
  })) as { user?: SignedInUser };
  if (!data?.user?.id) {
    throw new OmgAuthError("That code didn't work. Try again.", 401);
  }
  return data.user;
}

export async function getSession(): Promise<SignedInUser | null> {
  try {
    const response = await fetch(`${AUTH_ORIGIN}${BETTER_AUTH_BASE}/get-session`, {
      headers: { "Content-Type": "application/json", Origin: AUTH_REQUEST_ORIGIN },
    });
    if (!response.ok) return null;
    const data = (await response.json().catch(() => null)) as {
      user?: SignedInUser;
    } | null;
    return data?.user?.id ? data.user : null;
  } catch {
    return null;
  }
}

/**
 * Ask the server to revoke the session, and throw SignOutFailedError if it
 * did not confirm that. Every prior version of this function did
 * `fetch(...).catch(() => {})` and cleared local state unconditionally — a
 * missing Origin header (see AUTH_REQUEST_ORIGIN) made the server 403 this
 * on every single call, and the swallowed rejection meant the app declared
 * "signed out" while the session, and its cookie, stayed valid for up to 30
 * days. That is worse than an error the caller has to handle: it is a false
 * claim about account state. So this throws instead of swallowing, and the
 * caller (provider.tsx) is required to leave local state untouched when it
 * does — showing "signed out" is only correct once the server agrees.
 *
 * Fails closed on purpose: a network-unreachable sign-out attempt throws the
 * same as a server rejection, rather than clearing local state as a
 * fallback. The alternative — clear locally whenever the server can't be
 * reached — reopens exactly this bug for anyone offline at the moment they
 * sign out (bad wifi, airplane mode, a lost device with connectivity cut).
 * Being stuck showing "signed in" while offline is a recoverable annoyance;
 * being shown "signed out" while a token is still live is not.
 */
export async function signOut(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${AUTH_ORIGIN}${BETTER_AUTH_BASE}/sign-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: AUTH_REQUEST_ORIGIN },
    });
  } catch {
    throw new SignOutFailedError(
      "Couldn't reach omg to sign out. Check your connection and try again.",
    );
  }
  // 401 means better-auth already considers this session gone (expired,
  // already revoked elsewhere) — nothing left to revoke, so this is a
  // success, not a failure: the goal state ("this device holds no valid
  // session") already holds.
  if (!response.ok && response.status !== 401) {
    throw new SignOutFailedError(
      `Sign-out was rejected (${response.status}). Your session may still be active — try again.`,
    );
  }
  cachedToken = null;
  inFlight = null;
}

/**
 * Process-wide JWT owner.
 *
 * The dashboard learned this the hard way: several surfaces each called their
 * own token hook and a cold Computer did five concurrent /token round trips
 * before its first request. A hook shares code, never state — so the cache and
 * the in-flight promise live at module scope, where they are actually shared.
 *
 * TTL matches the web client's 30s. The JWT itself lives longer; the short
 * cache just bounds how stale a reused token can be while still collapsing a
 * burst of callers into one mint.
 */
const TOKEN_TTL_MS = 30_000;

let cachedToken: { token: string; fetchedAt: number } | null = null;
let inFlight: Promise<string | null> | null = null;

async function mintToken(): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`${AUTH_ORIGIN}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: AUTH_APP_ID }),
    });
  } catch {
    throw new OmgAuthError("Couldn't reach omg. Check your connection.", 0);
  }
  // Not signed in is an ordinary answer here, not a failure to report: the
  // caller turns null into the sign-in screen.
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new OmgAuthError(`Couldn't authenticate (${response.status})`, response.status);
  }
  const data = (await response.json().catch(() => null)) as { token?: string } | null;
  return data?.token ?? null;
}

export function getAuthToken(): Promise<string | null> {
  if (cachedToken && Date.now() - cachedToken.fetchedAt < TOKEN_TTL_MS) {
    return Promise.resolve(cachedToken.token);
  }
  if (inFlight) return inFlight;
  inFlight = mintToken()
    .then((token) => {
      cachedToken = token ? { token, fetchedAt: Date.now() } : null;
      return token;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Drop the cached JWT so the next call re-mints. */
export function clearAuthToken(): void {
  cachedToken = null;
  inFlight = null;
}
