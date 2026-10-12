import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type * as Apple from "@expo/apple-utils";
import {
  appleRequestUrl, loginToAppleDeveloper, prepareAppleCookieCache,
  requireLocalAppleLogin, restrictAppleRequests, validateAppleId, type AppleLoginSdk,
} from "./apple-login";

const username = "tester@example.com";
const teamId = "ABCDEFGHIJ";
const sdkSession = () => ({
  username, password: "test-secret-password",
  cookies: { cookies: [{ key: "myacinfo", value: "test-secret-cookie" }] }, context: { teamId },
}) as unknown as Awaited<ReturnType<typeof Apple.Auth.loginAsync>>;
const sdkTeam = () => ({
  teamId, name: "Test team", status: "active", memberships: [{ status: "active", platform: "ios" }],
}) as Awaited<ReturnType<typeof Apple.Teams.getTeamsAsync>>[number];

function fakeSdk(session = sdkSession(), team = sdkTeam()) {
  let resetCount = 0;
  const calls: unknown[][] = [];
  const sdk: AppleLoginSdk = {
    Auth: {
      resetInMemoryData: () => { resetCount++; },
      loginAsync: async (...args) => { calls.push(args); return session; },
    },
    Teams: { getTeamsAsync: async () => [team] },
  };
  return { sdk, session, calls, resets: () => resetCount };
}

describe("local Apple login", () => {
  // Catch regressions that expose credentials, skip verification, or send
  // expired sessions through anything other than Expo's password/2FA prompts.
  test("requires the user's interactive Mac terminal", () => {
    expect(() => requireLocalAppleLogin("linux", true)).toThrow("on your Mac");
    expect(() => requireLocalAppleLogin("darwin", false)).toThrow("interactive terminal");
    expect(() => requireLocalAppleLogin("darwin", true)).not.toThrow();
  });
  test("rejects account names that can escape the SDK cookie directory", () => {
    expect(validateAppleId(` ${username} `)).toBe(username);
    for (const invalid of ["../../someone@example.com", "a\\b@example.com", "email", "", "a\nb@example.com"]) {
      expect(() => validateAppleId(invalid)).toThrow("email address");
    }
  });
  test("uses Expo's restore/password/2FA flow and returns only the verified team", async () => {
    const fake = fakeSdk();
    const connection = await loginToAppleDeveloper(` ${username} `, fake.sdk, teamId);
    expect(fake.calls).toEqual([[{ username, teamId }, { autoResolveProvider: true }]]);
    expect(connection).toEqual({ appleId: username, teamId, teamName: "Test team" });
    expect(JSON.stringify(connection)).not.toContain("test-secret");
    expect(fake.session.password).toBeUndefined();
    expect(fake.resets()).toBe(2);
  });
  test("does not report a different cached account as connected", async () => {
    const session = sdkSession(); session.username = "other@example.com";
    const fake = fakeSdk(session);
    await expect(loginToAppleDeveloper(username, fake.sdk)).rejects.toThrow("different account");
    expect(fake.resets()).toBe(2);
  });
  test("does not report a missing or different team as connected", async () => {
    const team = sdkTeam(); team.teamId = "OTHERTEAM1";
    await expect(loginToAppleDeveloper(username, fakeSdk(sdkSession(), team).sdk)).rejects.toThrow("verify the selected");
    await expect(loginToAppleDeveloper(username, fakeSdk().sdk, "OTHERTEAM1")).rejects.toThrow("verify the selected");
  });
  test("rejects inactive, free, and Mac-only memberships", async () => {
    for (const change of [
      (team: ReturnType<typeof sdkTeam>) => { team.status = "inactive"; },
      (team: ReturnType<typeof sdkTeam>) => { team.memberships = []; },
      (team: ReturnType<typeof sdkTeam>) => { team.memberships[0].status = "expired"; },
      (team: ReturnType<typeof sdkTeam>) => { team.memberships[0].platform = "mac"; },
    ]) {
      const team = sdkTeam(); change(team);
      await expect(loginToAppleDeveloper(username, fakeSdk(sdkSession(), team).sdk)).rejects.toThrow("active Apple Developer membership");
    }
  });
  test("does not return raw SDK errors or their credentials", async () => {
    const fake = fakeSdk();
    fake.sdk.Auth.loginAsync = async () => { throw new Error("test-secret-password test-secret-cookie"); };
    let message = "";
    try { await loginToAppleDeveloper(username, fake.sdk); } catch (error) { message = String(error); }
    expect(message).toContain("Apple sign-in failed");
    expect(message).not.toContain("test-secret");
    expect(fake.resets()).toBe(2);
  });
  test("handles cancellation and clears the in-memory Apple session", async () => {
    const fake = fakeSdk();
    fake.sdk.Auth.loginAsync = async () => { throw { isCancelledPrompt: true }; };
    await expect(loginToAppleDeveloper(username, fake.sdk)).rejects.toThrow("cancelled");
    expect(fake.resets()).toBe(2);
  });
});

describe("Apple cookie permissions", () => {
  let userHome: string | undefined;
  afterEach(() => { if (userHome) rmSync(userHome, { recursive: true, force: true }); });
  function testHome() {
    const root = join(homedir(), ".cache", "lfg", "tmp"); mkdirSync(root, { recursive: true });
    return userHome = mkdtempSync(join(root, "apple-login-test-"));
  }
  test("restricts existing Expo cookies without replacing them", () => {
    const home = testHome(); const accountDir = join(home, ".app-store", "auth", username);
    mkdirSync(accountDir, { recursive: true, mode: 0o755 });
    const cookie = join(accountDir, "cookie"); writeFileSync(cookie, "test-cookie"); chmodSync(cookie, 0o644);
    prepareAppleCookieCache(username, home);
    expect(readFileSync(cookie, "utf8")).toBe("test-cookie");
    expect(statSync(cookie).mode & 0o777).toBe(0o600);
    for (const dir of [join(home, ".app-store"), join(home, ".app-store", "auth"), accountDir]) {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    }
  });
  test("refuses a symlinked cookie cache", () => {
    const home = testHome(); const elsewhere = join(home, "elsewhere"); mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(home, ".app-store"));
    expect(() => prepareAppleCookieCache(username, home)).toThrow("real directories");
  });
});

describe("Apple request boundary", () => {
  test("rejects cleartext and non-Apple destinations", () => {
    expect(appleRequestUrl("auth/signin", "https://idmsa.apple.com/").hostname).toBe("idmsa.apple.com");
    for (const invalid of [
      "http://idmsa.apple.com/", "https://apple.com.attacker.test/", "https://attackerapple.com/",
      "https://user:secret@idmsa.apple.com/", "https://idmsa.apple.com:8443/", "https://expo.dev/",
    ]) expect(() => appleRequestUrl(invalid)).toThrow("only to Apple");
  });
  test("enforces the boundary on the real Expo HTTP client before transport runs", async () => {
    const sdk = await import("@expo/apple-utils");
    const client = sdk.getRequestClient(); const cleanup = restrictAppleRequests(sdk); let requests = 0;
    try {
      const adapter: NonNullable<typeof client.defaults.adapter> = async (config: {
        maxRedirects?: number; timeout?: number;
      }) => {
        requests++;
        expect(config.maxRedirects).toBe(0); expect(config.timeout).toBe(30_000);
        return { config, data: {}, status: 200, statusText: "OK", headers: {} };
      };
      await expect(client.get("https://expo.dev/login", { adapter })).rejects.toThrow("only to Apple");
      expect(requests).toBe(0);
      await client.get("https://appstoreconnect.apple.com/olympus/v1/session", { adapter });
      expect(requests).toBe(1);
    } finally { cleanup(); sdk.Auth.resetInMemoryData(); }
  });
});
