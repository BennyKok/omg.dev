// omg Cloud account on a self-hosted box.
//
// The box, not the browser, holds the account credential. The browser asks
// this server to start a sign-in, gets sent to auth.omg.dev, and comes back to
// /api/cloud/callback on this server, which exchanges the code and writes
// ~/.omg/credentials.json — the same file `omg login` (BennyKok/vibes
// packages/cli/src/auth.ts) writes, in the same shape. One credential serves
// the CLI and the UI, and signing in from either place signs in both.
//
// The credential is an OAuth 2.1 access token for the CLI resource
// (https://backend.omg.dev/api/cli). It is accepted at /api/cli/* on the
// control plane, which is where the machine list comes from. It is NOT a
// dashboard /token JWT, so it cannot mint session grants on
// sessions.omgs.app; that needs a control-plane change before the local UI
// can switch its transport onto a cloud machine.
//
// The web UI reads this server's /api/cloud/* routes only. The token never
// reaches the browser, and the browser needs no cookie for auth.omg.dev.

import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CLOUD_CREDENTIALS_PATH = join(homedir(), ".omg", "credentials.json");

/** Mirrors `Credentials` in the vibes CLI. Do not add fields it would drop. */
export type CloudCredentials = {
  /** Either an omg_sk_ API key or an OAuth access token. */
  token: string;
  /** Unix ms. Absent for API keys, which do not expire on a schedule. */
  expiresAt?: number;
  kind: "api-key" | "jwt" | "oauth";
  refreshToken?: string;
  clientId?: string;
  authUrl?: string;
  resource?: string;
};

export type CloudAccountStatus = {
  signedIn: boolean;
  /** Best effort, read from the token's claims. Null for an opaque token. */
  email: string | null;
  expiresAt: number | null;
  kind: CloudCredentials["kind"] | null;
  authUrl: string;
  /**
   * This box's own binding id on the account, when it is paired through
   * `omg connect`. The account's machine list includes this box like any
   * other; the UI uses this to show it once, as "This computer".
   */
  thisBoxId: string | null;
};

/** One row of GET /api/cli/computer/status on the control plane. */
export type CloudComputerRow = {
  slug: string;
  name: string;
  kind: "cloud" | "connected";
  online: boolean;
  status: string;
  isDefault: boolean;
  lastSeenAt?: number | null;
  defaultFolder?: string | null;
  [extra: string]: unknown;
};

export type CloudComputerList = {
  computers: CloudComputerRow[];
  defaultComputer: string;
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CloudAccountOptions {
  credentialPath?: string;
  authUrl?: string;
  controlPlaneUrl?: string;
  resource?: string;
  fetch?: FetchLike;
  now?: () => number;
  /** How long a started sign-in waits for its callback. Default 10 minutes. */
  pendingTtlMs?: number;
  /** This box's relay binding id, read fresh each time. Null when not paired. */
  thisBoxId?: () => string | null;
}

export interface CloudAccount {
  /** Answers /api/cloud/* or returns null for any other path. */
  handleRequest(req: Request, url: URL): Promise<Response | null>;
  status(): CloudAccountStatus;
  /** A usable access token, refreshed when close to expiry. Null when signed out. */
  getAccessToken(): Promise<string | null>;
  listComputers(): Promise<CloudComputerList>;
}

export class CloudAccountError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = "CloudAccountError";
  }
}

// Same defaults and env names as the vibes CLI, so one environment configures
// both.
const DEFAULT_AUTH_URL = "https://auth.omg.dev";
const DEFAULT_CONTROL_PLANE_URL = "https://backend.omg.dev";
const DEFAULT_RESOURCE = "https://backend.omg.dev/api/cli";
// omg:computer is what /api/cli/computer/* checks. The rest keeps the saved
// credential interchangeable with the one `omg login` writes.
const OAUTH_SCOPES = "openid email omg:apps omg:computer offline_access";
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

const base64Url = (bytes: Buffer) =>
  bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const pkceChallenge = (verifier: string) => base64Url(createHash("sha256").update(verifier).digest());

export function loadCloudCredentials(path = CLOUD_CREDENTIALS_PATH): CloudCredentials | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Partial<CloudCredentials>;
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    const kind = parsed.kind === "api-key" || parsed.kind === "jwt" ? parsed.kind : "oauth";
    return { ...parsed, token: parsed.token, kind };
  } catch {
    return null;
  }
}

export function saveCloudCredentials(creds: CloudCredentials, path = CLOUD_CREDENTIALS_PATH): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

export function clearCloudCredentials(path = CLOUD_CREDENTIALS_PATH): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/** The `email` claim of a JWT, without verifying it. Display only. */
export function tokenEmail(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

async function oauthFailure(response: Response, action: string): Promise<CloudAccountError> {
  const text = await response.text().catch(() => "");
  let detail = text;
  try {
    const body = JSON.parse(text) as { error?: string; error_description?: string };
    detail = body.error_description || body.error || text;
  } catch {
    // Keep the raw response.
  }
  return new CloudAccountError(
    `${action} failed (${response.status}): ${detail || response.statusText}`,
    502,
  );
}

type PendingLogin = {
  verifier: string;
  clientId: string;
  redirectUri: string;
  returnTo: string;
  createdAt: number;
};

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...init?.headers },
  });
}

function htmlPage(ok: boolean, message: string): Response {
  const title = ok ? "Signed in to omg Cloud" : "Sign-in failed";
  const safe = message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:16px system-ui;max-width:36rem;margin:15vh auto;padding:0 1.5rem"><h1>${title}</h1><p>${safe}</p></body>`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

/** Only a same-origin path may be a return target. Anything else goes home. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/";
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || /[\r\n]/.test(trimmed)) return "/";
  return trimmed;
}

export function createCloudAccount(options: CloudAccountOptions = {}): CloudAccount {
  const credentialPath = options.credentialPath ?? CLOUD_CREDENTIALS_PATH;
  const authUrl = (
    options.authUrl ?? (process.env.OMG_AUTH_URL?.trim() || DEFAULT_AUTH_URL)
  ).replace(/\/+$/, "");
  const controlPlaneUrl = (
    options.controlPlaneUrl ?? (process.env.OMG_API_URL?.trim() || DEFAULT_CONTROL_PLANE_URL)
  ).replace(/\/+$/, "");
  const resource = options.resource ?? (process.env.OMG_OAUTH_RESOURCE?.trim() || DEFAULT_RESOURCE);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const pendingTtlMs = options.pendingTtlMs ?? 10 * 60 * 1000;
  const pending = new Map<string, PendingLogin>();
  let refreshing: Promise<CloudCredentials | null> | null = null;

  const prunePending = () => {
    for (const [state, entry] of pending) {
      if (entry.createdAt + pendingTtlMs < now()) pending.delete(state);
    }
  };

  async function requestToken(params: URLSearchParams, action: string) {
    const response = await fetchImpl(`${authUrl}/api/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: params,
    });
    if (!response.ok) throw await oauthFailure(response, action);
    const token = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!token.access_token || !Number.isFinite(token.expires_in) || Number(token.expires_in) <= 0) {
      throw new CloudAccountError(`${action} returned an incomplete token response.`, 502);
    }
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: Number(token.expires_in),
    };
  }

  async function registerClient(redirectUri: string): Promise<string> {
    const response = await fetchImpl(`${authUrl}/api/auth/oauth2/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_name: "omg.dev computer",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });
    if (!response.ok) throw await oauthFailure(response, "Client registration");
    const client = (await response.json()) as { client_id?: string };
    if (!client.client_id) throw new CloudAccountError("Client registration returned no client_id.", 502);
    return client.client_id;
  }

  async function refresh(creds: CloudCredentials): Promise<CloudCredentials | null> {
    if (!creds.refreshToken || !creds.clientId) return null;
    const token = await requestToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: creds.refreshToken,
        client_id: creds.clientId,
        resource: creds.resource ?? resource,
      }),
      "Session refresh",
    );
    const refreshed: CloudCredentials = {
      ...creds,
      token: token.accessToken,
      refreshToken: token.refreshToken ?? creds.refreshToken,
      expiresAt: now() + token.expiresIn * 1000,
    };
    saveCloudCredentials(refreshed, credentialPath);
    return refreshed;
  }

  async function getAccessToken(): Promise<string | null> {
    const creds = loadCloudCredentials(credentialPath);
    if (!creds) return null;
    if (creds.kind === "api-key" || !creds.expiresAt) return creds.token;
    if (creds.expiresAt > now() + REFRESH_WINDOW_MS) return creds.token;
    if (creds.kind === "oauth" && creds.refreshToken) {
      // One refresh at a time. A burst of callers on an expiring token must
      // not each spend the refresh token, which is single use on rotation.
      refreshing ??= refresh(creds).finally(() => {
        refreshing = null;
      });
      const refreshed = await refreshing;
      if (refreshed) return refreshed.token;
    }
    return creds.expiresAt > now() ? creds.token : null;
  }

  function status(): CloudAccountStatus {
    const creds = loadCloudCredentials(credentialPath);
    const live = creds && (!creds.expiresAt || creds.expiresAt > now() || Boolean(creds.refreshToken));
    return {
      signedIn: Boolean(live),
      email: creds ? tokenEmail(creds.token) : null,
      expiresAt: creds?.expiresAt ?? null,
      kind: creds?.kind ?? null,
      authUrl,
      thisBoxId: options.thisBoxId?.() ?? null,
    };
  }

  async function listComputers(): Promise<CloudComputerList> {
    const token = await getAccessToken();
    if (!token) throw new CloudAccountError("Not signed in to omg Cloud.", 401);
    const response = await fetchImpl(`${controlPlaneUrl}/api/cli/computer/status`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const text = await response.text().catch(() => "");
    let body: { computers?: unknown; defaultComputer?: unknown; error?: unknown } = {};
    try {
      body = text ? (JSON.parse(text) as typeof body) : {};
    } catch {
      body = {};
    }
    if (!response.ok) {
      // A credential written by an older `omg login` predates the omg:computer
      // scope. Only a new authorization can add it, so say that instead of
      // printing the server's error code.
      if (response.status === 403 && body.error === "insufficient_scope") {
        throw new CloudAccountError(
          "This sign-in has no computer access. Sign out, then sign in again.",
          403,
        );
      }
      const message = typeof body.error === "string" ? body.error : `Computer list failed (${response.status})`;
      throw new CloudAccountError(message, response.status === 401 ? 401 : 502);
    }
    return {
      computers: Array.isArray(body.computers) ? (body.computers as CloudComputerRow[]) : [],
      defaultComputer: typeof body.defaultComputer === "string" ? body.defaultComputer : "cloud",
    };
  }

  async function startLogin(req: Request, url: URL): Promise<Response> {
    let returnTo = "/";
    try {
      const body = (await req.json()) as { returnTo?: unknown };
      returnTo = safeReturnTo(body?.returnTo);
    } catch {
      // No body is fine.
    }
    // The callback lands on THIS server, at whatever address the browser used
    // to reach it. A box behind Tailscale is reached by its tailnet name, and
    // a redirect to 127.0.0.1 would land in the wrong browser.
    const redirectUri = `${url.origin}/api/cloud/callback`;
    const state = base64Url(randomBytes(32));
    const verifier = base64Url(randomBytes(64));
    const clientId = await registerClient(redirectUri);
    prunePending();
    pending.set(state, { verifier, clientId, redirectUri, returnTo, createdAt: now() });

    const authorizeUrl = new URL(`${authUrl}/api/auth/oauth2/authorize`);
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: OAUTH_SCOPES,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      state,
      resource,
    }).toString();
    return json({ authorizeUrl: authorizeUrl.toString() });
  }

  async function finishLogin(url: URL): Promise<Response> {
    const state = url.searchParams.get("state") ?? "";
    const entry = state ? pending.get(state) : undefined;
    pending.delete(state);
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      return htmlPage(false, url.searchParams.get("error_description") || oauthError);
    }
    if (!entry || entry.createdAt + pendingTtlMs < now()) {
      return htmlPage(false, "This sign-in link has expired. Go back to omg.dev and try again.");
    }
    const code = url.searchParams.get("code") ?? "";
    if (!code) return htmlPage(false, "The authorization server sent no code.");

    const token = await requestToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: entry.redirectUri,
        client_id: entry.clientId,
        code_verifier: entry.verifier,
        resource,
      }),
      "Token exchange",
    );
    saveCloudCredentials(
      {
        token: token.accessToken,
        refreshToken: token.refreshToken,
        clientId: entry.clientId,
        expiresAt: now() + token.expiresIn * 1000,
        authUrl,
        resource,
        kind: "oauth",
      },
      credentialPath,
    );
    return new Response(null, {
      status: 302,
      headers: { Location: entry.returnTo, "Cache-Control": "no-store" },
    });
  }

  return {
    status,
    getAccessToken,
    listComputers,
    async handleRequest(req, url) {
      const path = url.pathname;
      if (!path.startsWith("/api/cloud/")) return null;
      try {
        if (path === "/api/cloud/session" && req.method === "GET") return json(status());
        if (path === "/api/cloud/login" && req.method === "POST") return await startLogin(req, url);
        if (path === "/api/cloud/callback" && req.method === "GET") return await finishLogin(url);
        if (path === "/api/cloud/token" && req.method === "POST") {
          const token = await getAccessToken();
          return token ? json({ token }) : json({ error: "Not signed in to omg Cloud." }, { status: 401 });
        }
        if (path === "/api/cloud/logout" && req.method === "POST") {
          clearCloudCredentials(credentialPath);
          return json({ ok: true });
        }
        if (path === "/api/cloud/computers" && req.method === "GET") return json(await listComputers());
        return json({ error: "not found" }, { status: 404 });
      } catch (error) {
        const status = error instanceof CloudAccountError ? error.status : 500;
        const message = error instanceof Error ? error.message : "omg Cloud request failed";
        if (path === "/api/cloud/callback") return htmlPage(false, message);
        return json({ error: message }, { status });
      }
    },
  };
}
