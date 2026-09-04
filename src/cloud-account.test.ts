import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createCloudAccount,
  loadCloudCredentials,
  safeReturnTo,
  saveCloudCredentials,
  tokenEmail,
  type CloudCredentials,
} from "./cloud-account.ts";

let dir: string;
let credentialPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omg-cloud-account-"));
  credentialPath = join(dir, "credentials.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Call = { url: string; init?: RequestInit };

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetch, calls };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function jwt(claims: Record<string, unknown>): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${enc({ alg: "EdDSA" })}.${enc(claims)}.sig`;
}

const request = (path: string, init?: RequestInit) => {
  const req = new Request(`http://box.tailnet:8766${path}`, init);
  return [req, new URL(req.url)] as const;
};

test("session reports signed out with no credential file", async () => {
  const account = createCloudAccount({ credentialPath, fetch: fakeFetch(() => jsonResponse({})).fetch });
  const [req, url] = request("/api/cloud/session");
  const response = await account.handleRequest(req, url);
  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({ signedIn: false, email: null });
  expect(await account.handleRequest(...request("/api/other"))).toBeNull();
});

test("login registers a client with this server's callback and the callback saves credentials", async () => {
  let clock = 1_000_000;
  const accessToken = jwt({ email: "ada@example.com" });
  const { fetch, calls } = fakeFetch((url, init) => {
    if (url.endsWith("/oauth2/register")) return jsonResponse({ client_id: "client-1" });
    if (url.endsWith("/oauth2/token")) {
      const params = new URLSearchParams(String(init?.body));
      expect(params.get("grant_type")).toBe("authorization_code");
      expect(params.get("code")).toBe("code-1");
      expect(params.get("client_id")).toBe("client-1");
      expect(params.get("redirect_uri")).toBe("http://box.tailnet:8766/api/cloud/callback");
      expect(params.get("code_verifier")?.length).toBeGreaterThan(40);
      return jsonResponse({ access_token: accessToken, refresh_token: "refresh-1", expires_in: 3600 });
    }
    return jsonResponse({ error: "unexpected" }, 500);
  });
  const account = createCloudAccount({
    credentialPath,
    authUrl: "https://auth.example",
    fetch,
    now: () => clock,
  });

  const login = await account.handleRequest(
    ...request("/api/cloud/login", {
      method: "POST",
      body: JSON.stringify({ returnTo: "/settings?tab=cloud" }),
    }),
  );
  expect(login?.status).toBe(200);
  const { authorizeUrl } = (await login?.json()) as { authorizeUrl: string };
  const authorize = new URL(authorizeUrl);
  expect(authorize.origin).toBe("https://auth.example");
  expect(authorize.pathname).toBe("/api/auth/oauth2/authorize");
  expect(authorize.searchParams.get("redirect_uri")).toBe("http://box.tailnet:8766/api/cloud/callback");
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("scope")).toContain("omg:computer");
  const registration = JSON.parse(String(calls[0]?.init?.body)) as { redirect_uris: string[] };
  expect(registration.redirect_uris).toEqual(["http://box.tailnet:8766/api/cloud/callback"]);

  const state = authorize.searchParams.get("state")!;
  const callback = await account.handleRequest(
    ...request(`/api/cloud/callback?code=code-1&state=${encodeURIComponent(state)}`),
  );
  expect(callback?.status).toBe(302);
  expect(callback?.headers.get("Location")).toBe("/settings?tab=cloud");

  const saved = loadCloudCredentials(credentialPath);
  expect(saved).toMatchObject({
    token: accessToken,
    refreshToken: "refresh-1",
    clientId: "client-1",
    kind: "oauth",
    expiresAt: clock + 3_600_000,
    authUrl: "https://auth.example",
  });
  expect(statSync(credentialPath).mode & 0o777).toBe(0o600);

  const session = await account.handleRequest(...request("/api/cloud/session"));
  expect(await session?.json()).toMatchObject({ signedIn: true, email: "ada@example.com" });

  // A state can be used once.
  const replay = await account.handleRequest(
    ...request(`/api/cloud/callback?code=code-1&state=${encodeURIComponent(state)}`),
  );
  expect(replay?.status).toBe(400);
});

test("callback rejects an unknown state and reports a provider error", async () => {
  const account = createCloudAccount({ credentialPath, fetch: fakeFetch(() => jsonResponse({})).fetch });
  const unknown = await account.handleRequest(...request("/api/cloud/callback?code=x&state=nope"));
  expect(unknown?.status).toBe(400);
  expect(await unknown?.text()).toContain("expired");
  const denied = await account.handleRequest(
    ...request("/api/cloud/callback?error=access_denied&error_description=No+thanks"),
  );
  expect(await denied?.text()).toContain("No thanks");
  expect(loadCloudCredentials(credentialPath)).toBeNull();
});

test("token refreshes once when close to expiry and shares the refresh between callers", async () => {
  let clock = 10_000_000;
  saveCloudCredentials(
    {
      token: "old",
      refreshToken: "refresh-1",
      clientId: "client-1",
      expiresAt: clock + 60_000,
      kind: "oauth",
    },
    credentialPath,
  );
  let refreshes = 0;
  const { fetch } = fakeFetch((url, init) => {
    if (url.endsWith("/oauth2/token")) {
      refreshes += 1;
      const params = new URLSearchParams(String(init?.body));
      expect(params.get("grant_type")).toBe("refresh_token");
      expect(params.get("refresh_token")).toBe("refresh-1");
      return jsonResponse({ access_token: "new", refresh_token: "refresh-2", expires_in: 7200 });
    }
    return jsonResponse({}, 500);
  });
  const account = createCloudAccount({ credentialPath, fetch, now: () => clock });

  const [a, b] = await Promise.all([account.getAccessToken(), account.getAccessToken()]);
  expect(a).toBe("new");
  expect(b).toBe("new");
  expect(refreshes).toBe(1);
  expect(loadCloudCredentials(credentialPath)).toMatchObject({ token: "new", refreshToken: "refresh-2" });

  clock += 1_000;
  expect(await account.getAccessToken()).toBe("new");
  expect(refreshes).toBe(1);
});

test("an api key never refreshes and an expired token with no refresh reads as signed out", async () => {
  const { fetch, calls } = fakeFetch(() => jsonResponse({}, 500));
  saveCloudCredentials({ token: "omg_sk_live_x", kind: "api-key" }, credentialPath);
  const account = createCloudAccount({ credentialPath, fetch, now: () => 5 });
  expect(await account.getAccessToken()).toBe("omg_sk_live_x");
  expect(calls).toHaveLength(0);

  saveCloudCredentials({ token: "t", kind: "jwt", expiresAt: 1 }, credentialPath);
  expect(await account.getAccessToken()).toBeNull();
  expect(account.status().signedIn).toBe(false);
});

test("computers come from the control plane CLI status route with the bearer token", async () => {
  saveCloudCredentials({ token: "omg_sk_live_x", kind: "api-key" }, credentialPath);
  const { fetch, calls } = fakeFetch((url) =>
    url.endsWith("/api/cli/computer/status")
      ? jsonResponse({
          computers: [
            { slug: "cloud", name: "Cloud computer", kind: "cloud", online: true, status: "live", isDefault: true },
            { slug: "macbook", name: "macbook", kind: "connected", online: false, status: "offline", isDefault: false },
          ],
          defaultComputer: "cloud",
        })
      : jsonResponse({}, 404),
  );
  const account = createCloudAccount({
    credentialPath,
    controlPlaneUrl: "https://backend.example/",
    fetch,
  });
  const response = await account.handleRequest(...request("/api/cloud/computers"));
  expect(response?.status).toBe(200);
  const body = (await response?.json()) as { computers: { slug: string }[]; defaultComputer: string };
  expect(body.computers.map((c) => c.slug)).toEqual(["cloud", "macbook"]);
  expect(body.defaultComputer).toBe("cloud");
  expect(calls[0]?.url).toBe("https://backend.example/api/cli/computer/status");
  expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer omg_sk_live_x");
});

test("a credential without the computer scope reads as a re-sign-in", async () => {
  saveCloudCredentials({ token: "omg_sk_live_x", kind: "api-key" }, credentialPath);
  const { fetch } = fakeFetch(() => jsonResponse({ error: "insufficient_scope", scope: "omg:computer" }, 403));
  const account = createCloudAccount({ credentialPath, fetch });
  const response = await account.handleRequest(...request("/api/cloud/computers"));
  expect(response?.status).toBe(403);
  expect(await response?.json()).toEqual({
    error: "This sign-in has no computer access. Sign out, then sign in again.",
  });
});

test("computers answers 401 when signed out and logout removes the credential", async () => {
  const account = createCloudAccount({ credentialPath, fetch: fakeFetch(() => jsonResponse({})).fetch });
  const signedOut = await account.handleRequest(...request("/api/cloud/computers"));
  expect(signedOut?.status).toBe(401);

  saveCloudCredentials({ token: "omg_sk_live_x", kind: "api-key" }, credentialPath);
  expect(readFileSync(credentialPath, "utf8")).toContain("omg_sk_live_x");
  const logout = await account.handleRequest(...request("/api/cloud/logout", { method: "POST" }));
  expect(logout?.status).toBe(200);
  expect(loadCloudCredentials(credentialPath)).toBeNull();
});

test("helpers: return targets stay on this origin and token email is best effort", () => {
  expect(safeReturnTo("/settings")).toBe("/settings");
  expect(safeReturnTo("//evil.example")).toBe("/");
  expect(safeReturnTo("https://evil.example")).toBe("/");
  expect(safeReturnTo(undefined)).toBe("/");
  expect(tokenEmail(jwt({ email: "a@b.c" }))).toBe("a@b.c");
  expect(tokenEmail("omg_sk_live_x")).toBeNull();
  const creds: CloudCredentials = { token: "x", kind: "oauth" };
  saveCloudCredentials(creds, credentialPath);
  expect(loadCloudCredentials(credentialPath)).toEqual(creds);
});
