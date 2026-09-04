/**
 * Where this client points, and how it decides.
 *
 * The app speaks to a Computer through one of two transports, exactly like the
 * web surface does:
 *
 *   direct  — a box you can already reach on the network (`lfg serve` on your
 *             laptop, over Tailscale). No application-layer auth; the server
 *             has none. Perimeter is the network.
 *   hosted  — omg.dev's session origin, which proxies to your paired machine or
 *             your cloud Computer. Every request carries a signed grant.
 *
 * Keeping both is not hedging. The web app ships both for the same reason:
 * `createSameOriginTransport` for a self-hosted install, `createGrantTransport`
 * for app.omg.dev. A phone is simply never same-origin, so "direct" here is the
 * explicit-base-URL flavour of the same idea.
 */

/** Auth server that mints the short-lived app JWT. */
export const AUTH_ORIGIN =
  process.env.EXPO_PUBLIC_OMG_AUTH_URL ?? "https://auth.omg.dev";

/**
 * Origin header sent on every request to AUTH_ORIGIN.
 *
 * better-auth's origin-check middleware (trustedOrigins in
 * apps/auth/src/auth.ts) rejects state-changing requests that arrive with no
 * Origin header at all — a browser always sends one on a cross-origin fetch,
 * but React Native's fetch never does, native apps have no origin. Without
 * this, POST /api/auth/sign-out 403s with MISSING_OR_NULL_ORIGIN on every
 * call: the session is never revoked, sign-out silently no-ops server-side,
 * and the app has no way to know because the error is swallowed. The value
 * just needs to be one of the server's fixed trustedOrigins entries — it
 * does not need to describe this app.
 */
export const AUTH_REQUEST_ORIGIN = "https://omg.dev";

/**
 * Google sign-in client ids. Both are public identifiers, not secrets.
 *
 * WEB is the OAuth "Web application" client that auth.omg.dev verifies id
 * tokens against (better-auth checks `aud === GOOGLE_CLIENT_ID`), so it must be
 * the same id the server was deployed with. IOS is the "iOS" client bound to
 * the bundle id; the native SDK needs it to open the account picker, and its
 * reversed form is the URL scheme registered in app.config.js. When IOS is
 * unset the Google button does not render at all: a button that opens an SDK
 * with no client is a runtime error dressed as a feature.
 */
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
  "470443022473-ntdiuc043cfutlcbceolf7rcs14aars6.apps.googleusercontent.com";
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";

/** Control plane: account, machine bindings, cloud Computer lifecycle. */
export const CONTROLPLANE_ORIGIN =
  process.env.EXPO_PUBLIC_OMG_CONTROLPLANE_URL ?? "https://backend.omg.dev";

/** Session origin: the Computer itself, reached through the omg proxy. */
export const SESSION_ORIGIN = `https://${
  process.env.EXPO_PUBLIC_OMG_SESSION_HOST ?? "sessions.omgs.app"
}`;

export const SESSION_AUTH_PATH = "/__omg/session-auth";

/**
 * The JWT audience. The web client sends `{ appId: "vibes" }` to /token and the
 * mobile client is the same account on the same platform, so it asks for the
 * same one — a different appId would mint a token the session origin does not
 * accept.
 */
export const AUTH_APP_ID = "vibes";

/**
 * The account's managed cloud sandbox is addressed by this virtual binding id
 * rather than its real sandbox id, so instance ids and node URLs stay server
 * side. Mirrors CLOUD_COMPUTER_ID in the dashboard.
 */
export const CLOUD_BINDING_ID = "cloud";

export const STORAGE_KEYS = {
  /** Direct-mode base URL, e.g. http://100.x.y.z:8766 */
  directUrl: "omg:mobile:direct-url",
  /** "direct" | "hosted" */
  mode: "omg:mobile:mode",
  /** Last binding the user opened, so the app reopens where they left off. */
  binding: "omg:mobile:binding",
  /** Stable cloud-presence lease id, generated once per install. */
  presenceLeaseId: "omg:mobile:presence-lease-id",
  /**
   * Highest presence eventSeq ever issued. The server ignores a renewal whose
   * seq is not ahead of what it has stored, so this must survive restarts.
   */
  presenceEventSeq: "omg:mobile:presence-event-seq",
  /** better-auth session token (SecureStore, not AsyncStorage). */
  sessionToken: "omg:mobile:session-token",
  /**
   * The Expo push token this device last registered with the machine, so
   * Settings can show notifications as "on" without re-minting a token (and
   * so turning them off unregisters the exact token that's live server-side).
   */
  nativePushToken: "omg:mobile:native-push-token",
  /**
   * How the composer was last configured, per machine and agent: which model,
   * how hard to think. Validated against the box's catalog on load — a stored
   * choice can name something this machine no longer offers, and offering it
   * would be a 400 at launch discovered only after typing a prompt.
   */
  composerSetup: "omg:mobile:composer-setup",
  /** The session-list user filter: "__all", "__unassigned", or an email. */
  userFilter: "omg:mobile:user-filter",
} as const;

export type ComputerMode = "direct" | "hosted";

const trimTrailingSlash = (value: string) => value.trim().replace(/\/+$/, "");

/**
 * Default direct URL. Metro tells us which host is serving the bundle, which on
 * a dev build is the laptop running `lfg serve` — so the useful default is that
 * machine on the lfg port rather than a loopback the phone can never reach.
 */
export function defaultDirectUrl(metroHostUri?: string | null): string {
  const fromEnv = process.env.EXPO_PUBLIC_LFG_URL;
  if (fromEnv) return trimTrailingSlash(fromEnv);
  const host = metroHostUri?.split(":")[0];
  return host ? `http://${host}:8766` : "http://127.0.0.1:8766";
}

export { trimTrailingSlash };
