import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import { handleDeviceLink, handleDevicesApi } from "./http.ts";
import { handleLocalDeviceApi, isLocalDeviceUi, LOCAL_DEVICE_PREFIX } from "./local-http.ts";
import { DeviceRuntime } from "./runtime.ts";
import * as store from "./store.ts";

const oldData = PATHS.data;
const oldHome = process.env.OMG_DEVICE_HOME;
let root: string;
let controller: ReturnType<typeof Bun.serve>;
let receiver: ReturnType<typeof Bun.serve>;
let base: string;
const runtime = new DeviceRuntime();

async function ui(action?: string, body: unknown = {}) {
  const res = await fetch(`${base}${LOCAL_DEVICE_PREFIX}${action ? `/${action}` : ""}`, {
    method: action ? "POST" : "GET",
    headers: { origin: base, "content-type": "application/json", "x-omg-device-ui": "1" },
    ...(action ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json() as any };
}

async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await Bun.sleep(10);
  }
  throw new Error("Condition was not reached");
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "device-ui-"));
  PATHS.data = join(root, "controller");
  process.env.OMG_DEVICE_HOME = join(root, "receiver");
  await mkdir(process.env.OMG_DEVICE_HOME, { recursive: true });
  await writeFile(join(process.env.OMG_DEVICE_HOME, "config.json"), JSON.stringify({ actions: {
    inspect: { approval: "each", argv: ["/bin/echo", "device UI verified"] },
    wait: { approval: "each", argv: [process.execPath, "-e", `await Bun.write(${JSON.stringify(join(root, "running.pid"))}, String(process.pid)); await Bun.sleep(30000);`] },
  } }));
  controller = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleDeviceLink });
  receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req, server) => handleLocalDeviceApi(req, server.requestIP(req)?.address, runtime) });
  base = `http://127.0.0.1:${receiver.port}`;
  const pairing = await store.createPairing("receiver");
  const paired = await ui("connect", { code: pairing.code, server: `http://127.0.0.1:${controller.port}` });
  expect(paired.status).toBe(200);
  expect(paired.body.deviceId).toBe("receiver");
  expect(paired.body.active).toBe(false);
});

afterEach(async () => { await runtime.stop(); });
afterAll(async () => {
  controller.stop(true);
  receiver.stop(true);
  PATHS.data = oldData;
  if (oldHome === undefined) delete process.env.OMG_DEVICE_HOME; else process.env.OMG_DEVICE_HOME = oldHome;
  await rm(root, { recursive: true, force: true });
});

test("receiver routes require the local peer, local host, and same-origin UI intent", async () => {
  const req = (url = "http://localhost:8766/api/devices/_local/start", headers: Record<string, string> = {}) => new Request(url, {
    method: "POST", headers: { origin: "http://localhost:8766", "content-type": "application/json", "x-omg-device-ui": "1", ...headers }, body: "{}",
  });
  expect(isLocalDeviceUi(req(), "127.0.0.1")).toBe(true);
  expect(isLocalDeviceUi(req(), "100.64.0.1")).toBe(false);
  expect(isLocalDeviceUi(req(), undefined)).toBe(false);
  expect(isLocalDeviceUi(req("http://attacker.example/api/devices/_local/start"), "127.0.0.1")).toBe(false);
  for (const h of ["x-forwarded-for", "forwarded", "x-forwarded-host", "x-real-ip", "tailscale-user-login"]) expect(isLocalDeviceUi(req(undefined, { [h]: "127.0.0.1" }), "127.0.0.1")).toBe(false);
  expect(isLocalDeviceUi(req(undefined, { origin: "https://attacker.example" }), "127.0.0.1")).toBe(false);
  expect(isLocalDeviceUi(req(undefined, { "x-omg-device-ui": "" }), "127.0.0.1")).toBe(false);
  const bot = req();
  const denied = await handleDevicesApi(bot, new URL(bot.url).pathname, new URL(bot.url), { isBot: async () => true, peerAddress: "127.0.0.1" });
  expect(denied?.status).toBe(403);
});

test("UI approval runs only the pending request and stores its result in the local log", async () => {
  expect((await ui("start", { minutes: 15, idle: 15 })).status).toBe(200);
  const request = await store.createRequest({ deviceId: "receiver", action: "inspect", args: {}, requestedBy: "test-session" });
  await until(() => runtime.snapshot().pending !== null);
  const pending = (await ui()).body.pending;
  expect(pending.request.id).toBe(request.id);
  expect(pending.argv).toEqual(["/bin/echo", "device UI verified"]);
  expect((await store.getRequest(request.id))?.status).toBe("waiting-approval");
  expect((await ui("decision", { token: "wrong", allow: true })).status).toBe(400);
  expect((await ui("decision", { token: pending.token, allow: true })).status).toBe(200);
  expect((await ui("decision", { token: pending.token, allow: true })).status).toBe(400);
  await until(async () => (await store.getRequest(request.id))?.status === "done");
  expect(runtime.snapshot().activity.find((e) => e.kind === "done")?.update?.logTail).toContain("device UI verified");
  await ui("stop");
  expect(new DeviceRuntime().snapshot().activity.some((e) => e.kind === "done")).toBe(true);
});

test("Deny and Stop both settle a pending request without running it", async () => {
  for (const decision of ["deny", "stop"]) {
    await ui("start");
    const request = await store.createRequest({ deviceId: "receiver", action: "inspect", args: {} });
    await until(() => runtime.snapshot().pending !== null);
    const token = runtime.snapshot().pending!.token;
    if (decision === "deny") await ui("decision", { token, allow: false }); else await ui("stop");
    await until(async () => (await store.getRequest(request.id))?.status === "denied");
    expect((await store.getRequest(request.id))?.exitCode).toBeUndefined();
    await runtime.stop();
    expect((await ui("decision", { token, allow: true })).status).toBe(400);
  }
});

test("Stop kills a running action and releases the receiver for the next grant", async () => {
  await ui("start");
  const request = await store.createRequest({ deviceId: "receiver", action: "wait", args: {} });
  await until(() => runtime.snapshot().pending !== null);
  await ui("decision", { token: runtime.snapshot().pending!.token, allow: true });
  await until(async () => (await store.getRequest(request.id))?.status === "running");
  let pid = 0;
  await until(async () => { pid = Number(await readFile(join(root, "running.pid"), "utf8").catch(() => "0")); return pid > 0; });
  expect(() => process.kill(pid, 0)).not.toThrow();
  const before = Date.now();
  await ui("stop");
  expect(Date.now() - before).toBeLessThan(2000);
  expect((await store.getRequest(request.id))?.exitCode).toBe(130);
  expect((await store.getRequest(request.id))?.status).toBe("failed");
  expect(runtime.snapshot().active).toBe(false);
  await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
  expect((await ui("start")).status).toBe(200);
});

test("one receiver owns the device; a new runtime never restores an old grant", async () => {
  await ui("start");
  const other = new DeviceRuntime();
  expect(() => other.start()).toThrow("already owned");
  expect(other.snapshot().active).toBe(false);
  expect(other.snapshot().otherProcess).toBe(true);
  expect((await ui("connect", { server: "https://elsewhere.example", code: "unused" })).status).toBe(400);
  await runtime.stop();
  other.start();
  await other.stop();
});

test("duration limits cannot be bypassed with non-finite or invalid values", async () => {
  for (const minutes of [0, -1, 241, "Infinity", "NaN"]) expect((await ui("start", { minutes })).status).toBe(400);
  expect((await ui("start", { minutes: 15, idle: 16 })).status).toBe(400);
  expect(runtime.snapshot().active).toBe(false);
});

test("an expired prompt cannot approve, and idle expiry ends access", async () => {
  await ui("start", { minutes: 60, idle: 15 });
  const request = await store.createRequest({ deviceId: "receiver", action: "inspect", args: {} });
  await until(() => runtime.snapshot().pending !== null);
  const token = runtime.snapshot().pending!.token;
  const now = Date.now;
  try {
    const future = now() + 16 * 60_000;
    Date.now = () => future;
    expect((await ui("decision", { token, allow: true })).status).toBe(400);
    await until(() => !runtime.snapshot().active);
    expect(runtime.snapshot().pending).toBeNull();
    expect((await store.getRequest(request.id))?.status).toBe("denied");
  } finally { Date.now = now; }
});

test("controller activity expires queued requests even when the receiver is stopped", async () => {
  const request = await store.createRequest({ deviceId: "receiver", action: "inspect", args: {}, expiresInMs: 30_000 });
  const now = Date.now;
  try {
    const future = now() + 31_000;
    Date.now = () => future;
    expect((await store.listRequests()).find((r) => r.id === request.id)?.status).toBe("expired");
  } finally { Date.now = now; }
});
