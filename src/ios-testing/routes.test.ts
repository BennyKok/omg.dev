import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { iosSetupRoutes } from "./routes";
import { IosSetupStore } from "./setup-state";
import { iosSigningAccount } from "./cloud";

let root: string;
beforeEach(() => { const parent = join(homedir(), ".cache/lfg/tmp"); mkdirSync(parent, { recursive: true }); root = mkdtempSync(join(parent, "ios-routes-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function request(path: string, body = {}, origin = "http://127.0.0.1:8766") {
  return new Request(`http://127.0.0.1:8766/api/ios-testing/${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function routes(launch = async (_: "login" | "prepare") => {}) {
  return iosSetupRoutes({ root, runtimeRoot: "/runtime", desktop: true, platform: "darwin", launch, devices: async () => [{ udid: "phone1", name: "Test phone" }],
    cloudAccount: iosSigningAccount(root, () => ({ read: () => null, write() {}, remove() {} })) });
}
describe("local iOS setup routes", () => {
  test("rejects remote peers, web origins, and credential fields without opening Terminal", async () => {
    let opened = 0; const handle = routes(async () => { opened++; });
    expect((await handle(request("login"), "192.0.2.1"))!.status).toBe(403);
    expect((await handle(request("login", {}, "https://attacker.example"), "127.0.0.1"))!.status).toBe(403);
    expect((await handle(request("login", { password: "never-accepted" }), "127.0.0.1"))!.status).toBe(400);
    expect(opened).toBe(0);
  });
  test("opens the local login helper after a same-origin request", async () => {
    const actions: string[] = []; const handle = routes(async (action) => { actions.push(action); });
    expect((await handle(request("login"), "127.0.0.1"))!.status).toBe(202);
    expect(actions).toEqual(["login"]);
  });
  test("saves only devices returned by current USB discovery", async () => {
    const handle = routes();
    expect((await handle(request("select-devices", { deviceIds: ["unplugged"] }), "127.0.0.1"))!.status).toBe(409);
    expect((await handle(request("select-devices", { deviceIds: ["phone1"] }), "127.0.0.1"))!.status).toBe(200);
    expect(new IosSetupStore(root).read().devices).toEqual([{ udid: "phone1", name: "Test phone" }]);
  });
  test("will not prepare before account and device setup", async () => {
    expect((await routes()(request("prepare"), "127.0.0.1"))!.status).toBe(409);
  });
  test("returns a display-safe projection and no stored signing material", async () => {
    const store = new IosSetupStore(root);
    store.write({ connection: null, devices: [], profile: null, phase: "idle", error: null });
    writeFileSync(join(root, "status.json"), JSON.stringify({ ...store.read(), pkcs12Password: "test-secret", pkcs12Base64: "secret" }));
    const response = await routes()(new Request("http://127.0.0.1:8766/api/ios-testing"), "127.0.0.1");
    expect(await response!.text()).not.toContain("secret");
    expect(response!.headers.get("Cache-Control")).toBe("no-store");
  });
  test("Keychain access failure keeps Settings usable without exposing the storage error", async () => {
    const handle = iosSetupRoutes({ root, runtimeRoot: "/runtime", desktop: true, platform: "darwin",
      cloudAccount: iosSigningAccount(root, () => ({ read() { throw new Error("protected-refresh-fixture"); }, write() {}, remove() {} })) });
    const response = await handle(new Request("http://127.0.0.1:8766/api/ios-testing"), "127.0.0.1");
    const body = await response!.json() as { access: { signedIn: boolean }; error: string };
    expect(response!.status).toBe(200);
    expect(body.access.signedIn).toBe(false);
    expect(body.error).toContain("login Keychain");
    expect(JSON.stringify(body)).not.toContain("protected-refresh-fixture");
  });
  test("blocks concurrent local setup operations", async () => {
    const store = new IosSetupStore(root);
    await store.withLock(async () => {
      expect(store.busy()).toBe(true);
      expect((await routes()(request("login"), "127.0.0.1"))!.status).toBe(409);
    });
    expect(store.busy()).toBe(false);
  });
  test("rejects oversized input before launching a helper", async () => {
    expect((await routes()(request("login", { extra: "x".repeat(9000) }), "127.0.0.1"))!.status).toBe(413);
  });
  test("hides setup on a hosted or non-Mac runtime", async () => {
    const handle = iosSetupRoutes({ root, runtimeRoot: "/runtime", platform: "linux", desktop: false });
    const response = await handle(new Request("http://127.0.0.1:8766/api/ios-testing"), "127.0.0.1");
    expect(await response!.json()).toEqual({ supported: false });
    expect((await handle(request("login"), "127.0.0.1"))!.status).toBe(404);
  });
  test("never exposes the signing OAuth token through the local browser routes", async () => {
    const response = await routes()(request("cloud/token"), "127.0.0.1");
    expect(response!.status).toBe(404);
  });
});
