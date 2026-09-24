import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureConnectors } from "./context.ts";

import {
  clearOAuth,
  connectorByState,
  getOAuthState,
  hasTokens,
  saveClientInformation,
  savePending,
  saveTokens,
} from "./oauth-store.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omg-oauth-"));
  configureConnectors({ dataDir: () => tmp, secret: () => "test-secret", baseUrl: () => "http://127.0.0.1:8766" });
  });

afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
});

describe("connector oauth store", () => {
  test("tokens round-trip and are encrypted at rest", () => {
    saveTokens("c1", { access_token: "SECRET-TOKEN", token_type: "Bearer", refresh_token: "R" });
    expect(hasTokens("c1")).toBe(true);
    expect(getOAuthState("c1")?.tokens?.access_token).toBe("SECRET-TOKEN");

    // The file on disk must not contain the plaintext token.
    const raw = readFileSync(join(tmp, "connector-oauth.enc"), "utf8");
    expect(raw).not.toContain("SECRET-TOKEN");
    expect(raw).not.toContain("access_token");
  });

  test("pending authorization is resolvable by state, and cleared on token save", () => {
    savePending("c1", { state: "STATE123", codeVerifier: "verifier", redirectUri: "https://box/cb" });
    expect(connectorByState("STATE123")?.connectorId).toBe("c1");
    expect(connectorByState("nope")).toBeUndefined();

    saveTokens("c1", { access_token: "t", token_type: "Bearer" });
    expect(getOAuthState("c1")?.pending).toBeUndefined();
    expect(connectorByState("STATE123")).toBeUndefined();
  });

  test("client information (DCR) persists", () => {
    saveClientInformation("c1", { client_id: "abc", client_secret: "shh" });
    expect(getOAuthState("c1")?.clientInformation?.client_id).toBe("abc");
    const raw = readFileSync(join(tmp, "connector-oauth.enc"), "utf8");
    expect(raw).not.toContain("shh");
  });

  test("clear removes everything for a connector", () => {
    saveTokens("c1", { access_token: "t", token_type: "Bearer" });
    clearOAuth("c1");
    expect(hasTokens("c1")).toBe(false);
    expect(getOAuthState("c1")).toBeUndefined();
  });
});

describe("platform OAuth client", () => {
  const ID = "OMG_GOOGLE_CONNECTOR_CLIENT_ID";
  const SECRET = "OMG_GOOGLE_CONNECTOR_CLIENT_SECRET";
  afterEach(() => {
    delete process.env[ID];
    delete process.env[SECRET];
  });

  test("a managed Computer's client comes from the environment, and one saved on the box wins", async () => {
    const { getOAuthApp, oauthAppSource, saveOAuthApp } = await import("./oauth-store.ts");
    expect(getOAuthApp("google")).toBeUndefined();
    expect(oauthAppSource("google")).toBeNull();

    process.env[ID] = "omg.apps.googleusercontent.com";
    process.env[SECRET] = "platform-secret";
    expect(getOAuthApp("google")).toMatchObject({ clientId: "omg.apps.googleusercontent.com", clientSecret: "platform-secret" });
    expect(oauthAppSource("google")).toBe("platform");
    expect(oauthAppSource("slack")).toBeNull();

    saveOAuthApp("google", { clientId: "own.apps.googleusercontent.com", clientSecret: "own" });
    expect(getOAuthApp("google")?.clientId).toBe("own.apps.googleusercontent.com");
    expect(oauthAppSource("google")).toBe("box");
  });

  test("or from the file the control plane writes into the Computer", async () => {
    const { platformOAuthApp } = await import("./oauth-apps.ts");
    const file = join(tmp, "connector-clients.json");
    expect(platformOAuthApp("google", file)).toBeUndefined();
    writeFileSync(file, JSON.stringify({ google: { clientId: "file.apps.googleusercontent.com", clientSecret: "file-secret" } }));
    expect(platformOAuthApp("google", file)).toMatchObject({ clientId: "file.apps.googleusercontent.com", clientSecret: "file-secret" });
    expect(platformOAuthApp("slack", file)).toBeUndefined();
    writeFileSync(file, "not json");
    expect(platformOAuthApp("google", file)).toBeUndefined();
  });
});
