import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { configureConnectors } from "./context.ts";
import { isPlatformTokenExchangeUrl, platformOAuthApp, platformTokenEndpoint, platformTokenFetch } from "./oauth-apps.ts";
import { platformAuthOptions } from "./oauth-provider.ts";
import type { Connector } from "./store.ts";

const ID = "OMG_GOOGLE_CONNECTOR_CLIENT_ID";
const SECRET = "OMG_GOOGLE_CONNECTOR_CLIENT_SECRET";
let tmp: string;

beforeEach(() => {
  delete process.env[ID];
  delete process.env[SECRET];
  tmp = mkdtempSync(join(tmpdir(), "omg-platform-token-"));
  configureConnectors({ dataDir: () => tmp, secret: () => "test-secret", baseUrl: () => "http://127.0.0.1:8766" });
});

afterEach(() => {
  delete process.env[ID];
  delete process.env[SECRET];
  rmSync(tmp, { recursive: true, force: true });
});

describe("platform token exchange", () => {
  test("a client id with no secret is enough, and a secret in the file is still read", () => {
    const dir = mkdtempSync(join(tmpdir(), "omg-clients-"));
    const file = join(dir, "connector-clients.json");
    writeFileSync(file, JSON.stringify({ google: { clientId: "id.apps.googleusercontent.com" } }));
    expect(platformOAuthApp("google", file)).toMatchObject({ clientId: "id.apps.googleusercontent.com" });
    expect(platformOAuthApp("google", file)?.clientSecret).toBeUndefined();
    writeFileSync(file, JSON.stringify({ google: { clientId: "id.apps.googleusercontent.com", clientSecret: "still-here" } }));
    expect(platformOAuthApp("google", file)?.clientSecret).toBe("still-here");
  });

  test("token posts go to auth, and discovery does not", async () => {
    const seen: { url: string; body?: string }[] = [];
    const inner = async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), body: init?.body == null ? undefined : String(init.body) });
      return new Response("ok");
    };
    const fetchFn = platformTokenFetch("google", "https://auth.omg.dev", inner);
    expect(platformTokenEndpoint("google")).toBe("https://auth.omg.dev/connectors/google/token");
    expect(isPlatformTokenExchangeUrl("https://oauth2.googleapis.com/token")).toBe(true);
    expect(isPlatformTokenExchangeUrl("https://gmail.googleapis.com/.well-known/oauth-authorization-server")).toBe(false);
    await fetchFn("https://oauth2.googleapis.com/token", { method: "POST", body: "grant_type=authorization_code&code=abc" });
    await fetchFn("https://accounts.google.com/o/oauth2/token?x=1", { method: "POST", body: "grant_type=refresh_token" });
    await fetchFn("https://gmail.googleapis.com/.well-known/oauth-authorization-server");
    expect(seen.map((s) => s.url)).toEqual([
      "https://auth.omg.dev/connectors/google/token",
      "https://auth.omg.dev/connectors/google/token",
      "https://gmail.googleapis.com/.well-known/oauth-authorization-server",
    ]);
    expect(seen[0]?.body).toContain("code=abc");
  });

  test("only a platform client with no secret is sent through auth", () => {
    const connector = { id: "c1", oauthApp: "google" } as Connector;
    expect(platformAuthOptions(connector)).toEqual({});
    process.env[ID] = "omg.apps.googleusercontent.com";
    process.env[SECRET] = "platform-secret";
    expect(platformAuthOptions(connector)).toEqual({});
    delete process.env[SECRET];
    const opts = platformAuthOptions(connector);
    expect(opts.fetchFn).toBeTypeOf("function");
  });
});
