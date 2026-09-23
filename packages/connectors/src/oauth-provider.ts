// The MCP OAuth client provider for a connector, plus the start/complete flow.
//
// omg owns the OAuth: it runs the MCP spec's authorization (discovery, dynamic
// client registration, PKCE authorization-code) through the SDK, and stores the
// tokens encrypted (src/connectors/oauth-store.ts). Because the redirect_uri is
// omg's own callback — not a loopback daemon — the flow completes over remote
// access, and a hosted relay can hand omg the code for the managed UI.
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientMetadata, OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { randomBytes } from "node:crypto";
import type { Connector } from "./store.ts";
import { OAUTH_APPS } from "./oauth-apps.ts";
import {
  connectorByState,
  getOAuthApp,
  getOAuthState,
  saveClientInformation,
  savePending,
  saveTokens,
  type OAuthClientInfo,
  type OAuthTokenSet,
} from "./oauth-store.ts";

/** The redirect path omg exposes; the base (box or hosted relay) is supplied. */
export const OAUTH_CALLBACK_PATH = "/api/connectors/oauth/callback";

export function callbackUrl(base: string): string {
  return `${base.replace(/\/$/, "")}${OAUTH_CALLBACK_PATH}`;
}

/**
 * An OAuthClientProvider bound to one connector. `redirectToAuthorization`
 * captures the URL instead of navigating (this runs server-side); the caller
 * reads `authorizationUrl` and hands it to the browser.
 */
export class ConnectorOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | null = null;
  private _state: string;

  constructor(
    private connector: Connector,
    private redirectBase: string,
    state?: string,
  ) {
    this._state = state ?? randomBytes(16).toString("base64url");
  }

  get redirectUrl(): string {
    return callbackUrl(this.redirectBase);
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `omg (${this.connector.name})`,
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
  }

  state(): string {
    return this._state;
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    // A connector on a pre-registered app always uses that app's client, so
    // the SDK skips dynamic registration. No app configured yet means
    // undefined here, and startConnectorOAuth reports that before auth() runs.
    if (this.connector.oauthApp) {
      const app = getOAuthApp(this.connector.oauthApp);
      if (!app) return undefined;
      return {
        client_id: app.clientId,
        ...(app.clientSecret ? { client_secret: app.clientSecret } : {}),
        redirect_uris: [this.redirectUrl],
      } as OAuthClientInformationFull;
    }
    const info = getOAuthState(this.connector.id)?.clientInformation;
    return info as OAuthClientInformationFull | undefined;
  }

  saveClientInformation(info: OAuthClientInformationFull): void {
    if (this.connector.oauthApp) return;
    saveClientInformation(this.connector.id, info as unknown as OAuthClientInfo);
  }

  tokens(): OAuthTokens | undefined {
    return getOAuthState(this.connector.id)?.tokens as OAuthTokens | undefined;
  }

  saveTokens(tokens: OAuthTokens): void {
    saveTokens(this.connector.id, tokens as unknown as OAuthTokenSet);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    const extra = this.connector.oauthApp ? OAUTH_APPS[this.connector.oauthApp]?.authorizeParams : undefined;
    for (const [k, v] of Object.entries(extra ?? {})) authorizationUrl.searchParams.set(k, v);
    this.authorizationUrl = authorizationUrl;
  }

  saveCodeVerifier(codeVerifier: string): void {
    savePending(this.connector.id, { state: this._state, codeVerifier, redirectUri: this.redirectUrl });
  }

  codeVerifier(): string {
    const v = getOAuthState(this.connector.id)?.pending?.codeVerifier;
    if (!v) throw new Error("no pending OAuth authorization for this connector");
    return v;
  }
}

export type StartResult =
  | { ok: true; authorizeUrl: string; state: string }
  | { ok: true; alreadyAuthorized: true }
  | { ok: false; error: string; needsOAuthApp?: string };

/**
 * Begin OAuth for a connector: connect the transport with the provider, which
 * discovers, registers (DCR) and produces an authorization URL. Returns that
 * URL for the browser. If the connector already has a valid token, connect
 * succeeds and no authorization is needed.
 */
export async function startConnectorOAuth(
  connector: Connector,
  redirectBase: string,
  state?: string,
): Promise<StartResult> {
  // A caller may supply the `state` so a hosted relay can encode which box the
  // provider's redirect belongs to (see docs/team-tooling-design.md). It stays
  // the CSRF token, so a caller-supplied state must still be unguessable.
  if (connector.oauthApp && !getOAuthApp(connector.oauthApp)) {
    const name = OAUTH_APPS[connector.oauthApp]?.name ?? connector.oauthApp;
    return { ok: false, error: `${name} sign-in is not set up on this box. Add a ${name} OAuth client first.`, needsOAuthApp: connector.oauthApp };
  }
  const provider = new ConnectorOAuthProvider(connector, redirectBase, state);
  try {
    // auth() runs discovery → dynamic client registration → PKCE, then either
    // reports AUTHORIZED (a valid token already exists) or REDIRECT (it called
    // provider.redirectToAuthorization with the URL to send the browser to).
    const result = await auth(provider, { serverUrl: connector.endpoint });
    if (result === "AUTHORIZED") return { ok: true, alreadyAuthorized: true };
    if (provider.authorizationUrl) {
      return { ok: true, authorizeUrl: provider.authorizationUrl.toString(), state: provider.state() };
    }
    return { ok: false, error: "the server did not return an authorization URL" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "could not start OAuth" };
  }
}

export type CompleteResult = { ok: true; connectorId: string } | { ok: false; error: string };

/**
 * Complete OAuth from a callback's `code` + `state`. Resolves the connector the
 * state belongs to, exchanges the code for tokens (the SDK's finishAuth), and
 * stores them. Called by the browser callback route and by a hosted relay.
 */
export async function completeConnectorOAuth(
  state: string,
  code: string,
  lookup: (id: string) => Connector | null,
): Promise<CompleteResult> {
  const record = connectorByState(state);
  if (!record?.pending) return { ok: false, error: "no pending authorization for this state" };
  const connector = lookup(record.connectorId);
  if (!connector) return { ok: false, error: "connector not found" };
  const base = new URL(record.pending.redirectUri);
  const provider = new ConnectorOAuthProvider(connector, `${base.protocol}//${base.host}`, state);
  try {
    // With the authorization code, auth() exchanges it for tokens (reading the
    // PKCE verifier back from the store) and saves them via the provider.
    const result = await auth(provider, { serverUrl: connector.endpoint, authorizationCode: code });
    if (result !== "AUTHORIZED") return { ok: false, error: "token exchange did not complete" };
    return { ok: true, connectorId: connector.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "token exchange failed" };
  }
}

/** The authProvider the hub uses for an OAuth connector's normal calls. */
export function hubAuthProvider(connector: Connector, redirectBase: string): OAuthClientProvider {
  return new ConnectorOAuthProvider(connector, redirectBase);
}

/** An error the hub reads as "this connection needs a sign-in" (isUnauthorizedError). */
export class ConnectorUnauthorizedError extends Error {
  readonly code = 401;
  constructor(message = "This connection needs a sign-in. Click Connect.") {
    super(message);
  }
}

const EXPIRY_MARGIN_MS = 60_000;
const refreshing = new Map<string, Promise<string>>();

/**
 * A bearer for a native connector's REST calls. Uses the stored access token
 * until shortly before it expires, then refreshes through the SDK's auth()
 * (which exchanges the refresh token and saves the result). `force` refreshes
 * regardless, for a 401 on a token that should still be valid. Concurrent
 * callers share one refresh.
 */
export function connectorTokenSource(connector: Connector, redirectBase: string): (force?: boolean) => Promise<string> {
  return async (force = false) => {
    const state = getOAuthState(connector.id);
    const tokens = state?.tokens;
    if (!tokens?.access_token) throw new ConnectorUnauthorizedError();
    const expiresAt =
      state?.tokensSavedAt && typeof tokens.expires_in === "number"
        ? state.tokensSavedAt + tokens.expires_in * 1000 - EXPIRY_MARGIN_MS
        : Number.POSITIVE_INFINITY;
    if (!force && Date.now() < expiresAt) return tokens.access_token;
    if (!tokens.refresh_token) throw new ConnectorUnauthorizedError();
    const inflight = refreshing.get(connector.id);
    if (inflight) return inflight;
    const run = (async () => {
      const provider = new ConnectorOAuthProvider(connector, redirectBase);
      const result = await auth(provider, { serverUrl: connector.endpoint }).catch(() => "FAILED" as const);
      const fresh = getOAuthState(connector.id)?.tokens?.access_token;
      if (result !== "AUTHORIZED" || !fresh) throw new ConnectorUnauthorizedError("The sign-in expired. Click Connect to sign in again.");
      return fresh;
    })().finally(() => refreshing.delete(connector.id));
    refreshing.set(connector.id, run);
    return run;
  };
}
