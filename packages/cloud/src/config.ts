/**
 * Where an omg Cloud client points.
 *
 * Every consumer of this package reaches the same three origins, but from a
 * different place: the hosted dashboard from its own domain, the native app
 * from a phone, and a self-hosted `omg serve` UI from a loopback or tailnet
 * address. None of them share a cookie jar or an env prefix, so the endpoints
 * are a plain object the consumer builds once and passes in, never a module
 * global read from `process.env`.
 */

export interface CloudEndpoints {
  /** Auth server that holds the account session and mints the app JWT. */
  authOrigin: string;
  /** Control plane: account, machine bindings, cloud Computer lifecycle. */
  controlPlaneOrigin: string;
  /** Session origin: the Computer itself, reached through the omg proxy. */
  sessionOrigin: string;
}

export const DEFAULT_CLOUD_ENDPOINTS: CloudEndpoints = {
  authOrigin: "https://auth.omg.dev",
  controlPlaneOrigin: "https://backend.omg.dev",
  sessionOrigin: "https://sessions.omgs.app",
};

const trimSlash = (value: string) => value.trim().replace(/\/+$/, "");

/** Fill in the defaults and drop trailing slashes so path joins are exact. */
export function resolveCloudEndpoints(
  overrides: Partial<CloudEndpoints> = {},
): CloudEndpoints {
  return {
    authOrigin: trimSlash(overrides.authOrigin ?? DEFAULT_CLOUD_ENDPOINTS.authOrigin),
    controlPlaneOrigin: trimSlash(
      overrides.controlPlaneOrigin ?? DEFAULT_CLOUD_ENDPOINTS.controlPlaneOrigin,
    ),
    sessionOrigin: trimSlash(overrides.sessionOrigin ?? DEFAULT_CLOUD_ENDPOINTS.sessionOrigin),
  };
}

/** Grant mint route on the session origin. */
export const SESSION_AUTH_PATH = "/__omg/session-auth";

/**
 * The JWT audience. Every omg client is the same account on the same
 * platform, so they all ask for the same one; a different appId would mint a
 * token the session origin does not accept.
 */
export const AUTH_APP_ID = "vibes";

/**
 * The account's managed cloud sandbox is addressed by this virtual binding id
 * rather than its real sandbox id, so instance ids and node URLs stay server
 * side.
 */
export const CLOUD_BINDING_ID = "cloud";

/** A fetch a consumer may inject, for tests or a runtime with no global. */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Produces the account JWT, or null when nobody is signed in.
 *
 * Injected, not owned here: the hosted dashboard mints it from a browser
 * session, the native app from a platform cookie jar, and a self-hosted UI
 * from its own `omg serve`, which holds the credential on the box.
 */
export type GetAuthToken = () => Promise<string | null>;
