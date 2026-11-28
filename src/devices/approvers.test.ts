import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import { checkDecision, loadApprovers } from "./approvers.ts";
import { handleDeviceLink, handleDevicesApi } from "./http.ts";
import { handleLocalDeviceApi, LOCAL_DEVICE_PREFIX } from "./local-http.ts";
import { approvalString, approverIdFor, argsDigest, enrolmentProof, type WireEnrolment, type WireRemoteDecision } from "./protocol.ts";
import { DeviceRuntime } from "./runtime.ts";
import * as store from "./store.ts";

const oldData = PATHS.data;
const oldHome = process.env.OMG_DEVICE_HOME;
let root: string;
let controller: ReturnType<typeof Bun.serve>;
let receiver: ReturnType<typeof Bun.serve>;
let base: string;
const runtime = new DeviceRuntime();

/** A phone: a P-256 key, as the iPhone's Secure Enclave makes, and what it signs. */
function phone(name = "Benny's iPhone") {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const id = approverIdFor(jwk);
  return {
    name, id, x: jwk.x, y: jwk.y,
    enrol(code: string, device = "receiver"): WireEnrolment {
      const e = { device, name, x: jwk.x, y: jwk.y, nonce: randomBytes(16).toString("hex") };
      return { ...e, proof: enrolmentProof(code, e) };
    },
    decide(d: Partial<WireRemoteDecision> & Pick<WireRemoteDecision, "kind">, signWith = privateKey): WireRemoteDecision {
      const body = { device: "receiver", approver: id, target: "", allow: true, detail: "", issuedAt: Date.now(), nonce: randomBytes(16).toString("hex"), ...d };
      const sig = sign("sha256", Buffer.from(approvalString(body)), { key: signWith, dsaEncoding: "der" }).toString("base64");
      return { ...body, sig };
    },
  };
}

async function ui(action?: string, body: unknown = {}) {
  const res = await fetch(`${base}${LOCAL_DEVICE_PREFIX}${action ? `/${action}` : ""}`, {
    method: action ? "POST" : "GET",
    headers: { origin: base, "content-type": "application/json", "x-omg-device-ui": "1" },
    ...(action ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json() as any };
}

/** The person's phone (or an agent) calling the controller. */
async function api(method: string, path: string, body?: unknown) {
  const req = new Request(`http://127.0.0.1${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handleDevicesApi(req, path, new URL(req.url), { isBot: async () => false, callerSessionId: "agent-session" });
  return { status: res!.status, body: await res!.json() as any };
}

async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await Bun.sleep(10);
  }
  throw new Error("Condition was not reached");
}

async function enrolled() {
  const p = phone();
  const invite = (await ui("approver-invite")).body.approverInvite;
  const sent = await api("POST", "/api/devices/receiver/approvers", { enrolment: p.enrol(JSON.parse(invite.payload).code), wait: 5 });
  expect(sent.body.result).toEqual({ ok: true });
  return p;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "device-approvers-"));
  PATHS.data = join(root, "controller");
  process.env.OMG_DEVICE_HOME = join(root, "receiver");
  await mkdir(process.env.OMG_DEVICE_HOME, { recursive: true });
  await writeFile(join(process.env.OMG_DEVICE_HOME, "config.json"), JSON.stringify({ actions: {
    inspect: { approval: "each", argv: ["/bin/echo", "{word}"], args: { word: { pattern: "[a-z]+" } } },
  } }));
  controller = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleDeviceLink });
  receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req, server) => handleLocalDeviceApi(req, server.requestIP(req)?.address, runtime) });
  base = `http://127.0.0.1:${receiver.port}`;
  const pairing = await store.createPairing("receiver");
  expect((await ui("connect", { code: pairing.code, server: `http://127.0.0.1:${controller.port}` })).status).toBe(200);
});

afterEach(async () => {
  await runtime.stop();
  for (const a of loadApprovers()) runtime.dropApprover(a.id);
  runtime.closeInvite();
});

afterAll(async () => {
  runtime.shutdown();
  controller.stop(true);
  receiver.stop(true);
  PATHS.data = oldData;
  if (oldHome === undefined) delete process.env.OMG_DEVICE_HOME; else process.env.OMG_DEVICE_HOME = oldHome;
  await rm(root, { recursive: true, force: true });
});

test("a phone becomes an approver only with the code shown on the device", async () => {
  // Nothing listens for phones until one is being added here.
  const p = phone();
  const early = await api("POST", "/api/devices/receiver/approvers", { enrolment: p.enrol("WRONGCODEWRONGCODEAB"), wait: 1 });
  expect(early.status).toBe(409);
  expect(early.body.error).toContain("not listening");

  const invite = (await ui("approver-invite")).body.approverInvite;
  expect(JSON.parse(invite.payload)).toMatchObject({ omg: "approver", device: "receiver", code: invite.code });
  await until(() => store.remoteView("receiver").listening);

  const wrong = await api("POST", "/api/devices/receiver/approvers", { enrolment: p.enrol("WRONGCODEWRONGCODEAB"), wait: 5 });
  expect(wrong.body.result.ok).toBe(false);
  expect(loadApprovers()).toEqual([]);
  // Signed for another device: refused by the server before it travels.
  expect((await api("POST", "/api/devices/receiver/approvers", { enrolment: p.enrol(invite.code, "other") })).status).toBe(409);

  const right = await api("POST", "/api/devices/receiver/approvers", { enrolment: p.enrol(invite.code), wait: 5 });
  expect(right.body.result).toEqual({ ok: true });
  expect(loadApprovers().map((a) => a.id)).toEqual([p.id]);
  // The invite is used up: a second phone needs a new one.
  expect((await ui()).body.approverInvite).toBeNull();
  const late = await api("POST", "/api/devices/receiver/approvers", { enrolment: phone("thief").enrol(invite.code), wait: 5 });
  expect(late.body.result.ok).toBe(false);
  await until(async () => (await api("GET", "/api/devices")).body.devices[0].remote.approvers.length === 1);
  expect((await api("GET", "/api/devices")).body.devices[0].remote.approvers[0]).toMatchObject({ id: p.id, name: "Benny's iPhone" });
});

test("a phone starts access, approves the exact waiting action, and stops access", async () => {
  const p = await enrolled();
  const started = await api("POST", "/api/devices/receiver/remote", { decision: p.decide({ kind: "start", detail: "30,15" }), wait: 5 });
  expect(started.body.result).toEqual({ ok: true });
  expect(runtime.snapshot().active).toBe(true);
  expect(runtime.snapshot().grant!.endsAt - Date.now()).toBeLessThanOrEqual(30 * 60_000);

  const request = await store.createRequest({ deviceId: "receiver", action: "inspect", args: { word: "hello" }, requestedBy: "agent-session" });
  await until(() => runtime.snapshot().pending?.request.id === request.id);
  const open = (await api("GET", "/api/devices")).body.devices[0].open;
  expect(open.find((r: any) => r.id === request.id)).toMatchObject({ status: "waiting-approval", action: "inspect", args: { word: "hello" } });

  // A decision naming other arguments than what waits there does nothing.
  const swapped = await api("POST", "/api/devices/receiver/remote", { decision: p.decide({ kind: "request", target: request.id, detail: `inspect\n${argsDigest({ word: "other" })}` }), wait: 5 });
  expect(swapped.body.result.ok).toBe(false);
  expect(runtime.snapshot().pending?.request.id).toBe(request.id);

  const allowed = await api("POST", "/api/devices/receiver/remote", { decision: p.decide({ kind: "request", target: request.id, detail: `inspect\n${argsDigest({ word: "hello" })}` }), wait: 5 });
  expect(allowed.body.result).toEqual({ ok: true });
  await until(async () => (await store.getRequest(request.id))?.status === "done");

  const stopped = await api("POST", "/api/devices/receiver/remote", { decision: p.decide({ kind: "stop" }), wait: 5 });
  expect(stopped.body.result).toEqual({ ok: true });
  await until(() => !runtime.snapshot().active);
});

test("a phone answers an agent's extension request", async () => {
  const p = await enrolled();
  store.resetGrantState();
  await ui("start", { minutes: 30, idle: 15 });
  await until(() => store.activeGrant("receiver") !== null);
  const endsAt = runtime.snapshot().grant!.endsAt;
  const asked = await api("POST", "/api/devices/receiver/extend", { minutes: 60, wait: 0 });
  await runtime.heartbeat();
  expect(runtime.snapshot().extension?.id).toBe(asked.body.extension.id);
  const ok = await api("POST", "/api/devices/receiver/remote", { decision: p.decide({ kind: "extension", target: asked.body.extension.id, detail: "60" }), wait: 5 });
  expect(ok.body.result).toEqual({ ok: true });
  expect(runtime.snapshot().grant!.endsAt).toBe(endsAt + 60 * 60_000);
  await until(() => store.getExtension(asked.body.extension.id)?.status === "approved");
});

test("forged, foreign, stale and replayed decisions are refused on the device", async () => {
  const p = await enrolled();
  const stranger = phone("stranger");
  const forged = p.decide({ kind: "start", detail: "30,15" }, generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey);
  expect((await api("POST", "/api/devices/receiver/remote", { decision: forged, wait: 5 })).body.result).toEqual({ ok: false, reason: "the signature does not check out" });
  expect((await api("POST", "/api/devices/receiver/remote", { decision: stranger.decide({ kind: "start", detail: "30,15" }), wait: 5 })).body.result.ok).toBe(false);
  const old = p.decide({ kind: "start", detail: "30,15", issuedAt: Date.now() - 10 * 60_000 });
  expect((await api("POST", "/api/devices/receiver/remote", { decision: old, wait: 5 })).body.result.reason).toContain("too old");
  // A changed field breaks the signature: the server cannot turn 30 minutes into 4 hours.
  const changed = { ...p.decide({ kind: "start", detail: "30,15" }), detail: "240,never" };
  expect((await api("POST", "/api/devices/receiver/remote", { decision: changed, wait: 5 })).body.result.ok).toBe(false);
  expect(runtime.snapshot().active).toBe(false);

  const good = p.decide({ kind: "start", detail: "30,15" });
  expect((await api("POST", "/api/devices/receiver/remote", { decision: good, wait: 5 })).body.result).toEqual({ ok: true });
  await runtime.stop();
  // The same decision again, straight at the device (as a server replaying it would).
  expect(checkDecision(good, "receiver")).toEqual({ ok: false, reason: "this decision was already used" });
  expect(runtime.snapshot().active).toBe(false);
  // A long session is a choice made at the device only.
  const long = await api("POST", "/api/devices/receiver/remote", { decision: p.decide({ kind: "start", detail: "600,15" }), wait: 5 });
  expect(long.body.result.ok).toBe(false);
});

test("a phone removed at the device can no longer decide", async () => {
  const p = await enrolled();
  runtime.dropApprover(p.id);
  expect(checkDecision(p.decide({ kind: "start", detail: "30,15" }), "receiver")).toEqual({ ok: false, reason: "this phone is not an approver on the device" });
});
