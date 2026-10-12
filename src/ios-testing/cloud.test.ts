import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCloudAccount, type CloudCredentials } from "../cloud-account";
import { IosSigningCloud, iosSigningAccount, IOS_SIGNING_RESOURCE, IOS_SIGNING_SCOPES } from "./cloud";
import { IosSetupStore } from "./setup-state";
import { signingVaultAccount } from "./provisioning";
import type { SigningVault } from "./keychain";
let root: string;
beforeEach(() => { const parent = join(homedir(), ".cache/lfg/tmp"); mkdirSync(parent, { recursive: true }); root = mkdtempSync(join(parent, "ios-cloud-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
const token = (resource: string | string[] = IOS_SIGNING_RESOURCE) => `header.${Buffer.from(JSON.stringify({ sub: "owner1", aud: resource, scope: "omg:ios-signing", email: "test@example.com" })).toString("base64url")}.signature`;
const discovery = {
  issuer: "https://auth.example", authorization_endpoint: "https://auth.example/api/auth/oauth2/authorize",
  token_endpoint: "https://auth.example/api/auth/oauth2/token", registration_endpoint: "https://auth.example/api/auth/oauth2/register",
  code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
  grant_types_supported: ["authorization_code", "refresh_token"], prompt_values_supported: ["consent"], scopes_supported: IOS_SIGNING_SCOPES.split(" "),
};

test("the existing OAuth lifecycle requests a separate signing grant and explicit consent", async () => {
  const registrations: unknown[] = [];
  let saved: CloudCredentials | null = null;
  let clock = 1_000_000;
  const account = createCloudAccount({
    credentialPath: join(root, "signing.json"), authUrl: "https://auth.example", resource: IOS_SIGNING_RESOURCE,
    credentialStore: { id: root, load: () => saved, save: (credentials) => { saved = credentials; }, clear: () => { saved = null; } },
    now: () => clock,
    discoverOAuth: true,
    loopbackOnly: true,
    routePrefix: "/api/ios-testing/cloud", scopes: IOS_SIGNING_SCOPES, inheritIdentity: false,
    fetch: async (input, init) => {
      if (String(input).endsWith("/.well-known/oauth-authorization-server")) return Response.json(discovery);
      if (String(input).endsWith("/register")) { registrations.push(JSON.parse(String(init!.body))); return Response.json({ client_id: "ios-client" }); }
      if (String(input).endsWith("/token")) {
        const refresh = new URLSearchParams(String(init!.body)).get("grant_type") === "refresh_token";
        if (refresh) expect(new URLSearchParams(String(init!.body)).get("refresh_token")).toBe("refresh-fixture");
        return Response.json({ access_token: token(), expires_in: 3600, refresh_token: refresh ? "rotated-fixture" : "refresh-fixture" });
      }
      throw new Error("Unexpected endpoint");
    },
  });
  const response = await account.handleRequest(new Request("http://127.0.0.1:8766/api/ios-testing/cloud/login", { method: "POST", body: "{}" }), new URL("http://127.0.0.1:8766/api/ios-testing/cloud/login"));
  const authorization = await response!.json() as { authorizeUrl: string };
  const url = new URL(authorization.authorizeUrl);
  expect(url.searchParams.get("scope")).toBe(IOS_SIGNING_SCOPES);
  expect(url.searchParams.get("resource")).toBe(IOS_SIGNING_RESOURCE);
  expect(url.searchParams.get("prompt")).toBe("consent");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(registrations[0]).toMatchObject({ scope: IOS_SIGNING_SCOPES, application_type: "native" });
  const callback = new URL("http://127.0.0.1:8766/api/ios-testing/cloud/callback");
  callback.searchParams.set("state", url.searchParams.get("state")!); callback.searchParams.set("code", "one-use-code");
  expect((await account.handleRequest(new Request(callback.toString()), callback))!.status).toBe(302);
  expect(saved).toMatchObject({ resource: IOS_SIGNING_RESOURCE, refreshToken: "refresh-fixture" });
  expect(existsSync(join(root, "signing.json"))).toBe(false);
  clock += 3600_000;
  expect(await account.getAccessToken()).toBe(token());
  expect(saved).toMatchObject({ refreshToken: "rotated-fixture" });
  const logout = new URL("http://127.0.0.1:8766/api/ios-testing/cloud/logout");
  expect((await account.handleRequest(new Request(logout.toString(), { method: "POST" }), logout))!.status).toBe(200);
  expect(saved).toBeNull();
  expect(existsSync(join(root, "signing.json"))).toBe(false);
});

test("the native signing client rejects remote origins before reading credentials", async () => {
  let reads = 0;
  const account = iosSigningAccount(root, () => ({ read() { reads++; return null; }, write() {}, remove() {} }));
  for (const origin of ["https://remote.example", "http://192.0.2.1:8766", "https://127.0.0.1:8766"]) {
    const url = new URL(`${origin}/api/ios-testing/cloud/session`);
    expect((await account.handleRequest(new Request(url.toString()), url))!.status).toBe(403);
  }
  expect(reads).toBe(0);
});

test("a native callback on a different runtime port cannot exchange the code", async () => {
  let exchanges = 0;
  const account = createCloudAccount({ credentialPath: join(root, "wrong-port.json"), authUrl: "https://auth.example", loopbackOnly: true,
    fetch: async (input) => {
      if (String(input).endsWith("/register")) return Response.json({ client_id: "native-client" });
      exchanges++; return Response.json({ access_token: token(), expires_in: 3600 });
    } });
  const login = new URL("http://127.0.0.1:8766/api/cloud/login");
  const response = await account.handleRequest(new Request(login.toString(), { method: "POST", body: "{}" }), login);
  const { authorizeUrl } = await response!.json() as { authorizeUrl: string };
  const callback = new URL("http://127.0.0.1:8767/api/cloud/callback");
  callback.searchParams.set("state", new URL(authorizeUrl).searchParams.get("state")!);
  callback.searchParams.set("code", "valid-code");
  await account.handleRequest(new Request(callback.toString()), callback);
  expect(exchanges).toBe(0);
  expect(existsSync(join(root, "wrong-port.json"))).toBe(false);
});

test("native grant discovery rejects missing signing scope or an unexpected token endpoint before registration", async () => {
  for (const metadata of [ { ...discovery, scopes_supported: ["openid", "email", "offline_access"] }, { ...discovery, token_endpoint: "https://other.example/token" } ]) {
    const requests: string[] = [];
    const account = createCloudAccount({ credentialPath: join(root, "discovery.json"), authUrl: "https://auth.example",
      scopes: IOS_SIGNING_SCOPES, discoverOAuth: true,
      fetch: async (input) => { requests.push(String(input)); return Response.json(metadata); } });
    const url = new URL("http://127.0.0.1:8766/api/cloud/login");
    const response = await account.handleRequest(new Request(url.toString(), { method: "POST", body: "{}" }), url);
    expect(response!.status).toBe(503);
    expect(requests).toEqual(["https://auth.example/.well-known/oauth-authorization-server"]);
  }
});

test("the signing account reads and removes its grant only through the Keychain adapter", async () => {
  const items = new Map<string, string>();
  const keys: string[] = [];
  const keychain = {
    read(key: string) { keys.push(key); return items.get(key) ?? null; },
    write(key: string, value: string) { items.set(key, value); },
    remove(key: string) { items.delete(key); },
  };
  const account = iosSigningAccount(root, () => keychain);
  expect(account.status().signedIn).toBe(false);
  const key = keys[0]!;
  expect(key.startsWith("oauth/")).toBe(true);
  items.set(key, JSON.stringify({ token: token(), kind: "oauth", resource: IOS_SIGNING_RESOURCE, refreshToken: "protected-refresh", expiresAt: Date.now() + 3600_000 }));
  expect(await account.getAccessToken()).toBe(token());
  const second = iosSigningAccount(root, () => keychain);
  expect(second.status().signedIn).toBe(true);
  expect(iosSigningAccount(join(root, "other-state"), () => keychain).status().signedIn).toBe(false);
  const url = new URL("http://127.0.0.1:8766/api/ios-testing/cloud/logout");
  await second.handleRequest(new Request(url.toString(), { method: "POST" }), url);
  expect(items.has(key)).toBe(false);
  expect(account.status().signedIn).toBe(false);
  expect(existsSync(join(root, "cloud-credentials.json"))).toBe(false);
});

test("a damaged grant never exposes its Keychain contents in a browser error", async () => {
  const account = iosSigningAccount(root, () => ({ read: () => "protected-refresh-fixture", write() {}, remove() {} }));
  const url = new URL("http://127.0.0.1:8766/api/ios-testing/cloud/session");
  const response = await account.handleRequest(new Request(url.toString()), url);
  const body = await response!.text();
  expect(body).toContain("saved signing grant could not be read");
  expect(body).not.toContain("protected-refresh-fixture");
});

describe("signing upload lifecycle", () => {
  function fixture() {
    const store = new IosSetupStore(root);
    const connection = { appleId: "test@example.com", teamId: "ABCDEFGHIJ", teamName: "Test team" };
    const udid = "00008110-ABCDEF1234567890";
    store.write({ connection, devices: [{ udid, name: "Test iPhone" }], profile: { uuid: "profile1", expiresAt: 2e12, deviceIds: [udid] }, phase: "ready", error: null });
    const stored = new Map<string, string>();
    stored.set(signingVaultAccount(connection), JSON.stringify({
      version: 1, teamId: connection.teamId, certificateId: "cert1", certificateSha256: "a".repeat(64), certificateExpiresAt: 2e12,
      pkcs12Base64: "cDEy", pkcs12Password: "initial-password", profiles: [{ uuid: "profile1", expiresAt: 2e12, deviceIds: [udid], mobileprovisionBase64: "Y21z", bundleIdentifier: "*", appleId: "opaque1" }],
    }));
    const vault: SigningVault = { read: async (key) => stored.get(key) ?? null, write: async (key, value) => { stored.set(key, value); }, remove: async (key) => { stored.delete(key); } };
    const imports: string[] = []; const registrations: Array<{ udid: string; name: string }> = [];
    const enrolledIds: string[] = []; let fail = true; let prepares = 0;
    const account = {
      getAccessToken: async () => token(),
      cloudFetch: async (path: string, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        if (path.includes("?appId=")) return Response.json({ bundleId: "com.test.app", setup: null });
        if (path.endsWith("/devices")) {
          if (init?.method !== "POST") return Response.json({ devices: enrolledIds.map((id) => ({ udid: id, name: "Earlier iPhone", enrolledAt: 1 })) });
          const registration = JSON.parse(String(init.body)); registrations.push(registration);
          enrolledIds.push(registration.udid);
          return Response.json(registration);
        }
        if (path.endsWith("/import")) {
          imports.push(String(init?.body));
          if (fail) throw new Error("Lost transport response");
          return Response.json({ identityId: "identity1", profileId: "profile1", teamId: connection.teamId, certificateSha256: "a".repeat(64), expiresAt: 2e12, revision: 1, replayed: true, pkcs12Password: "must-not-reach-browser" });
        }
        throw new Error("Unexpected endpoint");
      },
    };
    const service = new IosSigningCloud(account, vault, store, async () => { prepares++; return Buffer.from("fresh PKCS12"); });
    return { service, account, store, imports, registrations, enrolledIds, udid, vault, connection, prepares: () => prepares, allowSuccess: () => { fail = false; } };
  }
  test("a lost response retains the immutable export and a retry uses the same payload", async () => {
    const f = fixture(); await expect(f.service.upload("app1")).rejects.toThrow("Lost transport");
    expect(f.store.read().pendingExport?.appId).toBe("app1");
    f.allowSuccess(); const result = await f.service.upload("app1");
    expect(JSON.stringify(result)).not.toContain("must-not-reach-browser");
    expect(f.imports[1]).toBe(f.imports[0]); expect(f.prepares()).toBe(1);
    expect(f.registrations).toEqual([{ udid: f.udid, name: "Test iPhone" }]);
    expect(f.store.read().uploaded).toMatchObject({ appId: "app1", revision: 1 });
    expect(f.store.read().pendingExport).toBeNull();
  });
  test("profile contents cannot enroll an unselected phone, including before selected phones", async () => {
    const f = fixture();
    const key = signingVaultAccount(f.connection);
    const record = JSON.parse((await f.vault.read(key))!);
    record.profiles[0].deviceIds.push("00008110-1111111111111111");
    await f.vault.write(key, JSON.stringify(record));
    await expect(f.service.upload("app1")).rejects.toThrow("Select each new iPhone");
    expect(f.registrations).toHaveLength(0);
    expect(f.imports).toHaveLength(0); expect(f.prepares()).toBe(0);
  });
  test("an already enrolled phone can remain in a profile without a new local selection", async () => {
    const f = fixture(); f.enrolledIds.push(f.udid);
    f.store.write({ ...f.store.read(), devices: [] });
    f.allowSuccess(); await f.service.upload("app1");
    expect(f.registrations).toHaveLength(0);
    expect(JSON.parse(f.imports[0]).deviceIds).toEqual([f.udid]);
  });
  test("does not reuse the ordinary CLI audience as signing authority", async () => {
    const f = fixture(); f.account.getAccessToken = async () => token("https://backend.omg.dev/api/cli");
    await expect(f.service.upload("app1")).rejects.toThrow("Allow iOS signing access");
    expect(f.imports).toHaveLength(0); expect(f.prepares()).toBe(0);
  });
  test("accepts the signing resource in the provider's audience list", async () => {
    const f = fixture();
    f.account.getAccessToken = async () => token(["https://auth.omg.dev/api/auth/oauth2/userinfo", IOS_SIGNING_RESOURCE]);
    f.allowSuccess(); await f.service.upload("app1");
    expect(f.imports).toHaveLength(1);
  });
  test("rejects an audience list without the signing resource", async () => {
    const f = fixture();
    f.account.getAccessToken = async () => token(["https://auth.omg.dev/api/auth/oauth2/userinfo", "https://backend.omg.dev/api/cli"]);
    await expect(f.service.upload("app1")).rejects.toThrow("Allow iOS signing access");
    expect(f.registrations).toHaveLength(0); expect(f.imports).toHaveLength(0);
  });
  test("does not send another account or app's pending export", async () => {
    const f = fixture(); await expect(f.service.upload("app1")).rejects.toThrow();
    await expect(f.service.upload("other-app")).rejects.toThrow("original account and app");
    expect(f.imports).toHaveLength(1);
  });
  test("does not retry a prepared upload after the selected Apple team changes", async () => {
    const f = fixture(); await expect(f.service.upload("app1")).rejects.toThrow();
    const state = f.store.read();
    f.store.write({ ...state, connection: { ...state.connection!, teamId: "OTHERTEAM1" } });
    await expect(f.service.upload("app1")).rejects.toThrow("original account and app");
    expect(f.imports).toHaveLength(1);
  });
});
