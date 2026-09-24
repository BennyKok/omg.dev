/**
 * The box's connectors, for the phone. The box owns them (the lfg repo,
 * packages/connectors); these are thin calls over the same transport every
 * other screen uses.
 *
 * The phone connects for the whole team only. Per-person and per-role
 * connections are managed on the web page, and the phone shows how many there
 * are rather than a second picker.
 *
 * Sign-in: the box starts it with `via: "app"`, so the provider returns to the
 * relay on auth.omg.dev, which redirects to omg://connectors/oauth. The auth
 * session catches that URL, and the code and state go back to the box, which
 * holds the verifier and client secret and does the exchange.
 */
import { openAuthSession } from "./in-app-browser";

export type Transport = { request<T>(path: string, init?: RequestInit): Promise<T> };

export const TEAM = "*org*";

export type Connector = {
  id: string;
  owner: string;
  name: string;
  slug: string;
  catalogSlug?: string;
  native?: string;
  account?: string;
  oauth?: boolean;
  oauthConnected?: boolean;
  icon?: string;
};

export type ConnectorApp = {
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  connectUrl: string | null;
  oauthApp?: string;
  native?: string;
};

function post(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export async function listConnectors(t: Transport): Promise<Connector[]> {
  const res = await t.request<{ connectors?: Connector[] }>("/api/connectors");
  return res?.connectors ?? [];
}

/** omg's tested connectors, the only ones offered. */
export async function listApps(t: Transport): Promise<ConnectorApp[]> {
  const res = await t.request<{ recommended?: ConnectorApp[] }>("/api/connectors/catalog?recommended=1");
  return res?.recommended ?? [];
}

export async function removeConnector(t: Transport, id: string): Promise<void> {
  await t.request(`/api/connectors/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** The accounts of one app, connected for the whole team. */
export function teamAccounts(connectors: Connector[], app: ConnectorApp): Connector[] {
  return connectors.filter((c) => c.owner === TEAM && (app.native ? c.native === app.native : c.catalogSlug === app.slug));
}

/** Pull `code` and `state` (or the provider's `error`) out of the relay's return URL. */
export function parseReturn(url: string): { code: string; state: string } | { error: string } {
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const params = new URLSearchParams(q);
  const error = params.get("error");
  if (error) return { error: error === "access_denied" ? "Sign-in was cancelled." : `Sign-in failed: ${error}` };
  const code = params.get("code");
  const state = params.get("state");
  return code && state ? { code, state } : { error: "Sign-in came back without a code." };
}

/**
 * Sign an existing connection in (or again). Resolves true when the box
 * stored the tokens, false when the person closed the page.
 */
export async function signIn(t: Transport, connectorId: string): Promise<boolean> {
  const start = await t.request<{ authorizeUrl?: string; alreadyAuthorized?: boolean; returnUrl?: string; error?: string }>(
    `/api/connectors/${encodeURIComponent(connectorId)}/oauth/start`,
    post({ via: "app" }),
  );
  if (start?.alreadyAuthorized) return true;
  if (!start?.authorizeUrl) throw new Error(start?.error ?? "Your Computer did not return a sign-in page.");
  const back = await openAuthSession(start.authorizeUrl, start.returnUrl ?? "omg://connectors/oauth");
  if (!back) return false;
  const parsed = parseReturn(back);
  if ("error" in parsed) throw new Error(parsed.error);
  await t.request("/api/connectors/oauth/callback", post(parsed));
  return true;
}

/** Add an app for the whole team and sign it in. A cancelled sign-in removes the empty row again. */
export async function connectForTeam(t: Transport, app: ConnectorApp): Promise<boolean> {
  if (!app.connectUrl) throw new Error(`${app.name} cannot be connected from here.`);
  const created = await t.request<{ connector: Connector }>(
    "/api/connectors",
    post({
      org: true,
      name: app.name,
      endpoint: app.connectUrl,
      catalogSlug: app.slug,
      icon: app.icon ?? undefined,
      oauth: true,
      oauthApp: app.oauthApp,
      native: app.native,
    }),
  );
  const id = created.connector.id;
  try {
    const ok = await signIn(t, id);
    if (!ok) await removeConnector(t, id).catch(() => {});
    return ok;
  } catch (e) {
    await removeConnector(t, id).catch(() => {});
    throw e;
  }
}
