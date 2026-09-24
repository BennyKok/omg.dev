import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureConnectors } from "./context.ts";

import type { Connector } from "./store.ts";
import { ConnectorOAuthProvider, OAUTH_CALLBACK_PATH, callbackUrl, completeConnectorOAuth, connectorTokenSource, startConnectorOAuth } from "./oauth-provider.ts";
import { getOAuthState, saveOAuthApp, saveTokens } from "./oauth-store.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omg-oauthp-"));
  configureConnectors({ dataDir: () => tmp, secret: () => "test-secret", baseUrl: () => "http://127.0.0.1:8766" });
  });

afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
});

const connector: Connector = {
  id: "c1",
  owner: "benny",
  name: "GitHub",
  slug: "github",
  kind: "mcp",
  endpoint: "https://mcp.example/mcp",
  headers: {},
  requireApproval: false,
  createdAt: 1,
  updatedAt: 1,
};

describe("ConnectorOAuthProvider", () => {
  test("redirect_uri and client metadata use the supplied base", () => {
    const p = new ConnectorOAuthProvider(connector, "https://dev.ts.net");
    expect(callbackUrl("https://dev.ts.net/")).toBe(`https://dev.ts.net${OAUTH_CALLBACK_PATH}`);
    expect(p.redirectUrl).toBe(`https://dev.ts.net${OAUTH_CALLBACK_PATH}`);
    expect(p.clientMetadata.redirect_uris).toEqual([`https://dev.ts.net${OAUTH_CALLBACK_PATH}`]);
    expect(p.clientMetadata.grant_types).toContain("authorization_code");
  });

  test("captures the authorization URL instead of redirecting", () => {
    const p = new ConnectorOAuthProvider(connector, "https://box");
    expect(p.authorizationUrl).toBeNull();
    p.redirectToAuthorization(new URL("https://auth.example/authorize?x=1"));
    expect(p.authorizationUrl?.toString()).toBe("https://auth.example/authorize?x=1");
  });

  test("code verifier persists keyed by state and reads back", () => {
    const p = new ConnectorOAuthProvider(connector, "https://box", "STATE");
    p.saveCodeVerifier("the-verifier");
    expect(getOAuthState("c1")?.pending?.state).toBe("STATE");
    expect(p.codeVerifier()).toBe("the-verifier");
  });

  test("codeVerifier throws when there is no pending authorization", () => {
    const p = new ConnectorOAuthProvider(connector, "https://box");
    expect(() => p.codeVerifier()).toThrow();
  });
});

// Google has no dynamic client registration. A connector on the "google" app
// signs in with the box's pre-registered client instead, and the authorize
// URL asks for offline access so a refresh token comes back.
describe("pre-registered OAuth app", () => {
  const gmail: Connector = { ...connector, id: "g1", name: "Gmail", slug: "gmail", endpoint: "https://gmailmcp.test/mcp/v1", oauth: true, oauthApp: "google" };
  const realFetch = globalThis.fetch;
  let tokenBody: URLSearchParams | null = null;
  let tokenAuth: string | null = null;

  beforeEach(() => {
    tokenBody = null;
    tokenAuth = null;
    // Shaped like Google's real metadata: PRM names the issuer, and the
    // issuer's OpenID configuration has no registration_endpoint.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
        return Response.json({ resource: gmail.endpoint, authorization_servers: ["https://accounts.test/"], scopes_supported: ["https://mail.google.com/"] });
      }
      if (url.host === "accounts.test" && url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          issuer: "https://accounts.test",
          authorization_endpoint: "https://accounts.test/o/oauth2/v2/auth",
          token_endpoint: "https://accounts.test/token",
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          jwks_uri: "https://accounts.test/certs",
        });
      }
      if (url.host === "accounts.test" && url.pathname === "/token") {
        tokenBody = new URLSearchParams(String(init?.body ?? ""));
        tokenAuth = new Headers(init?.headers).get("authorization");
        return Response.json({ access_token: "at", token_type: "Bearer", refresh_token: "rt", expires_in: 3599 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("start without a configured app asks for one instead of registering", async () => {
    const result = await startConnectorOAuth(gmail, "https://box");
    expect(result).toMatchObject({ ok: false, needsOAuthApp: "google" });
  });

  test("start and complete use the app client, with offline access", async () => {
    saveOAuthApp("google", { clientId: "cid.apps.googleusercontent.com", clientSecret: "shh" });
    const start = await startConnectorOAuth(gmail, "https://box", "S".repeat(20));
    if (!start.ok || !("authorizeUrl" in start)) throw new Error(`start failed: ${JSON.stringify(start)}`);
    const url = new URL(start.authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.test/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("cid.apps.googleusercontent.com");
    expect(url.searchParams.get("redirect_uri")).toBe(`https://box${OAUTH_CALLBACK_PATH}`);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toBe("https://mail.google.com/");
    // The app client is never written into the per-connector DCR slot.
    expect(getOAuthState("g1")?.clientInformation).toBeUndefined();

    const done = await completeConnectorOAuth("S".repeat(20), "the-code", (id) => (id === "g1" ? gmail : null));
    expect(done).toEqual({ ok: true, connectorId: "g1" });
    expect(tokenBody?.get("code")).toBe("the-code");
    const sentId = tokenBody?.get("client_id") ?? Buffer.from((tokenAuth ?? "").replace(/^Basic /, ""), "base64").toString().split(":")[0];
    expect(sentId).toBe("cid.apps.googleusercontent.com");
    expect(getOAuthState("g1")?.tokens?.refresh_token).toBe("rt");
  });

  test("a sign-in from the app returns through the relay, and the exchange repeats that exact URL", async () => {
    saveOAuthApp("google", { clientId: "cid.apps.googleusercontent.com", clientSecret: "shh" });
    const relay = "https://auth.omg.dev/connectors/google/callback";
    const start = await startConnectorOAuth(gmail, "http://127.0.0.1:8766", "R".repeat(20), relay);
    if (!start.ok || !("authorizeUrl" in start)) throw new Error(`start failed: ${JSON.stringify(start)}`);
    expect(new URL(start.authorizeUrl).searchParams.get("redirect_uri")).toBe(relay);
    const done = await completeConnectorOAuth("R".repeat(20), "app-code", (id) => (id === "g1" ? gmail : null));
    expect(done).toEqual({ ok: true, connectorId: "g1" });
    expect(tokenBody?.get("redirect_uri")).toBe(relay);
    expect(tokenBody?.get("code")).toBe("app-code");
  });

  test("a native connector asks only for its own scopes, not everything the resource lists", async () => {
    saveOAuthApp("google", { clientId: "cid.apps.googleusercontent.com", clientSecret: "shh" });
    const native: Connector = { ...gmail, id: "g2", kind: "native", native: "google-calendar" };
    const start = await startConnectorOAuth(native, "https://box", "T".repeat(20));
    if (!start.ok || !("authorizeUrl" in start)) throw new Error(`start failed: ${JSON.stringify(start)}`);
    expect(new URL(start.authorizeUrl).searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
    );
  });
});

describe("connectorTokenSource", () => {
  const gmail: Connector = { ...connector, id: "n1", name: "Gmail", slug: "gmail", kind: "native", native: "gmail", endpoint: "https://gmailmcp.test/mcp/v1", oauth: true, oauthApp: "google" };
  const realFetch = globalThis.fetch;
  let refreshes = 0;

  beforeEach(() => {
    refreshes = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
        return Response.json({ resource: gmail.endpoint, authorization_servers: ["https://accounts.test/"] });
      }
      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          issuer: "https://accounts.test", authorization_endpoint: "https://accounts.test/auth", token_endpoint: "https://accounts.test/token",
          response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"], jwks_uri: "https://accounts.test/certs",
        });
      }
      if (url.pathname === "/token") {
        refreshes += 1;
        expect(new URLSearchParams(String(init?.body)).get("grant_type")).toBe("refresh_token");
        return Response.json({ access_token: `at-${refreshes}`, token_type: "Bearer", expires_in: 3599 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    saveOAuthApp("google", { clientId: "cid", clientSecret: "shh" });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("no token means a sign-in is needed", async () => {
    await expect(connectorTokenSource(gmail, "https://box")()).rejects.toMatchObject({ code: 401 });
  });

  test("a valid token is used as is; force and expiry refresh it once, keeping the refresh token", async () => {
    saveTokens("n1", { access_token: "at-0", token_type: "Bearer", refresh_token: "rt", expires_in: 3599 });
    const source = connectorTokenSource(gmail, "https://box");
    expect(await source()).toBe("at-0");
    expect(refreshes).toBe(0);

    // Two concurrent forced callers share one refresh.
    const [a, b] = await Promise.all([source(true), source(true)]);
    expect([a, b]).toEqual(["at-1", "at-1"]);
    expect(refreshes).toBe(1);
    expect(getOAuthState("n1")?.tokens?.refresh_token).toBe("rt");

    saveTokens("n1", { access_token: "old", token_type: "Bearer", refresh_token: "rt", expires_in: 30 });
    expect(await source()).toBe("at-2");
  });
});
