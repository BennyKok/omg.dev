import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import { resetSessionSecretForTests } from "../policy/session-token.ts";
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
const originalData = PATHS.data;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omg-oauth-"));
  PATHS.data = tmp;
  resetSessionSecretForTests();
});

afterEach(() => {
  PATHS.data = originalData;
  resetSessionSecretForTests();
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
