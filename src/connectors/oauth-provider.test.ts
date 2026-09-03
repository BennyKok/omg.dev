import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import { resetSessionSecretForTests } from "../policy/session-token.ts";
import type { Connector } from "./store.ts";
import { ConnectorOAuthProvider, OAUTH_CALLBACK_PATH, callbackUrl } from "./oauth-provider.ts";
import { getOAuthState } from "./oauth-store.ts";

let tmp: string;
const originalData = PATHS.data;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omg-oauthp-"));
  PATHS.data = tmp;
  resetSessionSecretForTests();
});

afterEach(() => {
  PATHS.data = originalData;
  resetSessionSecretForTests();
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
