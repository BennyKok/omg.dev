// Providers whose MCP servers need a pre-registered OAuth client.
//
// The MCP spec's sign-in uses dynamic client registration. Google does not
// support it: its authorization server has no registration endpoint, so every
// Google MCP server (Gmail, Calendar, Drive, ...) needs a client created once
// in a Google Cloud console. The box stores that client encrypted
// (./oauth-store.ts, `apps`) and every connector with `oauthApp: "google"`
// signs in with it. The redirect URI registered with the client must be the
// box's callback, which the host reports with the app status.

export interface OAuthAppProvider {
  id: string;
  name: string;
  /** Where the owner creates the client. */
  consoleUrl: string;
  /** Extra authorize-URL parameters the provider needs. */
  authorizeParams: Record<string, string>;
}

export const OAUTH_APPS: Record<string, OAuthAppProvider> = {
  google: {
    id: "google",
    name: "Google",
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
    // Google returns a refresh token only for offline access, and only on a
    // consent screen, so a reconnect must ask for consent again.
    authorizeParams: { access_type: "offline", prompt: "consent" },
  },
};

export function isOAuthAppProvider(id: string): boolean {
  return Object.hasOwn(OAUTH_APPS, id);
}

export interface OAuthAppStatus {
  id: string;
  name: string;
  consoleUrl: string;
  configured: boolean;
  /** The start of the client id, so the owner can tell which client is set. Never the secret. */
  clientIdHint: string | null;
}

/** Every provider and whether this box has a client for it. Safe to hand to a client. */
export function oauthAppStatuses(lookup: (id: string) => { clientId: string } | undefined): OAuthAppStatus[] {
  return Object.values(OAUTH_APPS).map((p) => {
    const app = lookup(p.id);
    return {
      id: p.id,
      name: p.name,
      consoleUrl: p.consoleUrl,
      configured: !!app,
      clientIdHint: app ? `${app.clientId.slice(0, 12)}…` : null,
    };
  });
}
