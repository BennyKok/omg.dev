/**
 * Sign-in and the short-lived app JWT, against better-auth's REST surface.
 *
 * Raw `fetch` on purpose. better-auth's browser client manages a cookie jar,
 * and each consumer here has its own: the native app's platform jar, the
 * dashboard's document cookies, or nothing at all for a self-hosted UI that
 * lets its `omg serve` hold the credential. Keeping to three endpoints of
 * surface area is what lets one module serve all of them.
 *
 * /token authenticates with the session cookie the platform replays, so the
 * server needs no `bearer` plugin for this path.
 */

import { AUTH_APP_ID, resolveCloudEndpoints, type CloudEndpoints, type FetchLike } from "./config";

export class OmgAuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OmgAuthError";
    this.status = status;
  }
}

/**
 * The server did not confirm the session was revoked. Distinct from
 * OmgAuthError so a caller can tell "sign-out failed, the account may still
 * be signed in server-side" apart from an ordinary sign-in failure. A caller
 * must NOT treat this the same as a successful sign-out.
 */
export class SignOutFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignOutFailedError";
  }
}

export type SignedInUser = { id: string; email: string; name?: string };

export type SocialProvider = "apple" | "google";

export interface CloudAuthOptions {
  endpoints?: Partial<CloudEndpoints>;
  fetch?: FetchLike;
  /**
   * Value for the `Origin` header on every auth request.
   *
   * better-auth's origin check rejects state-changing requests that arrive
   * with no Origin header. A browser always sends one; React Native's fetch
   * never does. A consumer with no origin of its own sets one of the server's
   * trusted origins here. A browser consumer leaves it unset, because the
   * browser forbids overriding it anyway.
   */
  requestOrigin?: string;
  /** How long a minted JWT is reused before a fresh mint. Default 30 s. */
  tokenTtlMs?: number;
  now?: () => number;
}

export interface CloudAuth {
  sendSignInCode(email: string): Promise<void>;
  verifySignInCode(email: string, otp: string): Promise<SignedInUser>;
  signInWithIdToken(
    provider: SocialProvider,
    idToken: string,
    options?: { nonce?: string; name?: { firstName?: string; lastName?: string }; email?: string },
  ): Promise<SignedInUser>;
  getSession(): Promise<SignedInUser | null>;
  /** Throws SignOutFailedError unless the server confirmed revocation. */
  signOut(): Promise<void>;
  /** The account JWT, or null when nobody is signed in. Cached and deduplicated. */
  getAuthToken(): Promise<string | null>;
  /** Drop the cached JWT so the next call re-mints. */
  clearAuthToken(): void;
}

/**
 * better-auth's own routes are mounted under /api/auth, while the JWT exchange
 * at /token is a first-party route at the root. Mixing the two up is a silent
 * 404, so the prefix lives here once.
 */
const BETTER_AUTH_BASE = "/api/auth";

function parseJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

/**
 * One auth client per process.
 *
 * The token cache and the in-flight mint live on the instance, not in a hook
 * or a React context: a hook shares code, never state, and the dashboard once
 * paid five concurrent /token round trips on every cold Computer for exactly
 * that reason. Create this once and hand the same object to every consumer.
 */
export function createCloudAuth(options: CloudAuthOptions = {}): CloudAuth {
  const endpoints = resolveCloudEndpoints(options.endpoints);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const tokenTtlMs = options.tokenTtlMs ?? 30_000;
  const baseHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (options.requestOrigin) baseHeaders.Origin = options.requestOrigin;

  let cachedToken: { token: string; fetchedAt: number } | null = null;
  let inFlight: Promise<string | null> | null = null;

  async function authFetch(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${endpoints.authOrigin}${BETTER_AUTH_BASE}${path}`, {
        method: "POST",
        headers: baseHeaders,
        credentials: "include",
        body: JSON.stringify(body),
      });
    } catch {
      throw new OmgAuthError("Couldn't reach omg. Check your connection.", 0);
    }
    const data = parseJson(await response.text().catch(() => ""));
    if (!response.ok) {
      const record = data as { message?: string; error?: string };
      throw new OmgAuthError(
        record?.message ?? record?.error ?? `Sign-in failed (${response.status})`,
        response.status,
      );
    }
    return data;
  }

  async function mintToken(): Promise<string | null> {
    let response: Response;
    try {
      response = await fetchImpl(`${endpoints.authOrigin}/token`, {
        method: "POST",
        headers: baseHeaders,
        credentials: "include",
        body: JSON.stringify({ appId: AUTH_APP_ID }),
      });
    } catch {
      throw new OmgAuthError("Couldn't reach omg. Check your connection.", 0);
    }
    // Not signed in is an ordinary answer, not a failure: the caller turns
    // null into the sign-in screen.
    if (response.status === 401) return null;
    if (!response.ok) {
      throw new OmgAuthError(`Couldn't authenticate (${response.status})`, response.status);
    }
    const data = (await response.json().catch(() => null)) as { token?: string } | null;
    return data?.token ?? null;
  }

  const clearAuthToken = () => {
    cachedToken = null;
    inFlight = null;
  };

  return {
    async sendSignInCode(email) {
      // Rate limited per IP and reports success either way. Never auto-retry.
      await authFetch("/email-otp/send-verification-otp", {
        email: email.trim().toLowerCase(),
        type: "sign-in",
      });
    },

    async verifySignInCode(email, otp) {
      const data = (await authFetch("/sign-in/email-otp", {
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
      })) as { user?: SignedInUser };
      if (!data?.user?.id) throw new OmgAuthError("That code didn't work. Try again.", 401);
      return data.user;
    },

    async signInWithIdToken(provider, idToken, extra = {}) {
      const user =
        extra.name || extra.email
          ? { ...(extra.name ? { name: extra.name } : {}), ...(extra.email ? { email: extra.email } : {}) }
          : undefined;
      const data = (await authFetch("/sign-in/social", {
        provider,
        idToken: {
          token: idToken,
          ...(extra.nonce ? { nonce: extra.nonce } : {}),
          ...(user ? { user } : {}),
        },
      })) as { user?: SignedInUser };
      if (!data?.user?.id) throw new OmgAuthError("That sign-in didn't work. Try again.", 401);
      return data.user;
    },

    async getSession() {
      try {
        const response = await fetchImpl(`${endpoints.authOrigin}${BETTER_AUTH_BASE}/get-session`, {
          headers: baseHeaders,
          credentials: "include",
        });
        if (!response.ok) return null;
        const data = (await response.json().catch(() => null)) as { user?: SignedInUser } | null;
        return data?.user?.id ? data.user : null;
      } catch {
        return null;
      }
    },

    /**
     * Fails closed: a network failure throws the same as a server rejection
     * rather than clearing local state. Showing "signed in" while offline is
     * a recoverable annoyance; showing "signed out" while a token is still
     * live is a false claim about account state.
     */
    async signOut() {
      let response: Response;
      try {
        response = await fetchImpl(`${endpoints.authOrigin}${BETTER_AUTH_BASE}/sign-out`, {
          method: "POST",
          headers: baseHeaders,
          credentials: "include",
        });
      } catch {
        throw new SignOutFailedError(
          "Couldn't reach omg to sign out. Check your connection and try again.",
        );
      }
      // 401 means the session is already gone. The goal state already holds.
      if (!response.ok && response.status !== 401) {
        throw new SignOutFailedError(
          `Sign-out was rejected (${response.status}). Your session may still be active — try again.`,
        );
      }
      clearAuthToken();
    },

    getAuthToken() {
      if (cachedToken && now() - cachedToken.fetchedAt < tokenTtlMs) {
        return Promise.resolve(cachedToken.token);
      }
      if (inFlight) return inFlight;
      inFlight = mintToken()
        .then((token) => {
          cachedToken = token ? { token, fetchedAt: now() } : null;
          return token;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },

    clearAuthToken,
  };
}
