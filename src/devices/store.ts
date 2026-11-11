// Server side of the device link. The single owner of:
//   devices/devices.json            paired devices (public keys only)
//   devices/requests.json           recent requests and their results (bounded)
//   devices/files/<requestId>/      files a device sent back for one request
//   devices/log.jsonl               every pairing, request and decision (bounded)
// Pairing codes and poll waiters live in memory only: a restart forgets them,
// and a forgotten code is simply made again.
//
// Writes go through one in-process queue, so a device update and an agent's new
// request cannot overwrite each other.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import {
  ACTION_RE,
  FILE_NAME_RE,
  FINAL_STATUSES,
  MAX_CLOCK_SKEW_MS,
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
  MAX_LOG_TAIL,
  MAX_REQUEST_FILE_BYTES,
  NAME_RE,
  APPROVALS,
  type ActionInfo,
  type ArgSpec,
  type RequestStatus,
  type WireRequest,
  type WireUpdate,
} from "./protocol.ts";

export type Device = {
  id: string;
  publicKey: string;
  /** Tailscale address seen at pairing. Later calls must come from it. */
  tailnetIp?: string;
  pairedAt: number;
  lastSeenAt?: number;
  actions: ActionInfo[];
};

export type DeviceRequest = WireRequest & {
  deviceId: string;
  status: RequestStatus;
  createdAt: number;
  updatedAt: number;
  exitCode?: number;
  logTail?: string;
  reason?: string;
  files: Array<{ name: string; bytes: number }>;
};

export const PAIRING_TTL_MS = 10 * 60_000;
export const DEFAULT_EXPIRY_MS = 10 * 60_000;
export const MAX_EXPIRY_MS = 60 * 60_000;
const REQUESTS_KEEP = 500;
const MAX_OPEN_PER_DEVICE = 20;
const LOG_MAX_BYTES = 2 * 1024 * 1024;

const dir = () => join(PATHS.data, "devices");
const devicesPath = () => join(dir(), "devices.json");
const requestsPath = () => join(dir(), "requests.json");
const logPath = () => join(dir(), "log.jsonl");
export const requestFilesDir = (requestId: string) => join(dir(), "files", requestId);

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  const f = Bun.file(path);
  if (!(await f.exists())) return fallback;
  try {
    return JSON.parse(await f.text()) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dir(), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await Bun.write(tmp, JSON.stringify(value, null, 2));
  const { rename } = await import("node:fs/promises");
  await rename(tmp, path);
}

export async function logEvent(entry: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(dir(), { recursive: true, mode: 0o700 });
    const s = await stat(logPath()).catch(() => null);
    if (s && s.size > LOG_MAX_BYTES) {
      const lines = (await Bun.file(logPath()).text()).split("\n").filter(Boolean);
      await Bun.write(logPath(), lines.slice(-2000).join("\n") + "\n");
    }
    await appendFile(logPath(), JSON.stringify({ at: Date.now(), ...entry }) + "\n");
  } catch {
    // The log is a record, not a gate. A full disk must not block a kill switch.
  }
}

// ---- devices ----------------------------------------------------------------

export async function listDevices(): Promise<Device[]> {
  const rows = await readJson<unknown>(devicesPath(), []);
  return Array.isArray(rows) ? (rows as Device[]) : [];
}

export async function getDevice(id: string): Promise<Device | null> {
  return (await listDevices()).find((d) => d.id === id) ?? null;
}

/**
 * The server keeps a copy of a device's actions for listing and early errors.
 * It never runs a device-supplied pattern: the device checks its own rules.
 */
export function sanitizeActions(input: unknown): ActionInfo[] {
  if (!Array.isArray(input)) return [];
  const out: ActionInfo[] = [];
  for (const raw of input.slice(0, 100)) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    if (typeof a.name !== "string" || !ACTION_RE.test(a.name)) continue;
    const approval = APPROVALS.includes(a.approval as never) ? (a.approval as ActionInfo["approval"]) : "each";
    const args: Record<string, ArgSpec> = {};
    if (a.args && typeof a.args === "object") {
      for (const [k, v] of Object.entries(a.args as Record<string, unknown>).slice(0, 20)) {
        if (!/^[a-z][a-z0-9_]{0,39}$/.test(k) || !v || typeof v !== "object") continue;
        const s = v as Record<string, unknown>;
        args[k] = {
          optional: s.optional === true || undefined,
          allowDash: s.allowDash === true || undefined,
          enum: Array.isArray(s.enum) ? s.enum.filter((x): x is string => typeof x === "string").slice(0, 50).map((x) => x.slice(0, 100)) : undefined,
          pattern: typeof s.pattern === "string" ? s.pattern.slice(0, 200) : undefined,
          maxLength: typeof s.maxLength === "number" ? Math.min(Math.max(1, s.maxLength), 2000) : undefined,
        };
      }
    }
    const description = typeof a.description === "string" ? a.description.slice(0, 300) : undefined;
    out.push({ name: a.name, approval, args, description });
  }
  return out;
}

// ---- pairing ----------------------------------------------------------------

type Pairing = { code: string; name: string; expiresAt: number };
const pairings = new Map<string, Pairing>();

function pruneCodes(now = Date.now()) {
  for (const [code, p] of pairings) if (p.expiresAt <= now) pairings.delete(code);
}

/** A one-use code the human types on the device. It names the device in advance, so the device cannot pick a name that shadows another. */
export async function createPairing(name: string): Promise<Pairing> {
  if (!NAME_RE.test(name)) throw new Error("name: lowercase letters, digits and dashes, at most 40");
  if (await getDevice(name)) throw new Error(`a device named "${name}" is already linked. Remove it first.`);
  pruneCodes();
  // 10 characters from a 31-letter alphabet (no 0, O, 1, I, L): about 49 bits, one use, 10 minutes.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let code = "";
  for (const b of bytes) code += alphabet[b % alphabet.length];
  code = `${code.slice(0, 5)}-${code.slice(5)}`;
  const p = { code, name, expiresAt: Date.now() + PAIRING_TTL_MS };
  pairings.set(code, p);
  await logEvent({ kind: "pairing-created", device: name });
  return p;
}

function takePairing(code: string): Pairing | null {
  pruneCodes();
  const given = Buffer.from(code.toUpperCase());
  for (const [stored, p] of pairings) {
    const want = Buffer.from(stored);
    if (want.length === given.length && timingSafeEqual(want, given)) {
      pairings.delete(stored);
      return p;
    }
  }
  return null;
}

export function completePairing(input: {
  code: string;
  publicKey: string;
  tailnetIp?: string;
  actions: ActionInfo[];
}): Promise<Device> {
  return serial(async () => {
    const p = takePairing(input.code);
    if (!p) throw new Error("unknown or expired pairing code");
    const rows = await listDevices();
    if (rows.some((d) => d.id === p.name)) throw new Error(`a device named "${p.name}" is already linked`);
    const device: Device = {
      id: p.name,
      publicKey: input.publicKey,
      tailnetIp: input.tailnetIp,
      pairedAt: Date.now(),
      actions: input.actions,
    };
    await writeJson(devicesPath(), [...rows, device]);
    await logEvent({ kind: "paired", device: device.id, tailnetIp: device.tailnetIp, actions: device.actions.map((a) => a.name) });
    return device;
  });
}

/** The kill switch on this side. The device's next call fails with 401. */
export function removeDevice(id: string): Promise<boolean> {
  return serial(async () => {
    const rows = await listDevices();
    if (!rows.some((d) => d.id === id)) return false;
    await writeJson(devicesPath(), rows.filter((d) => d.id !== id));
    const reqs = await readRequests();
    const now = Date.now();
    for (const r of reqs) {
      if (r.deviceId === id && !FINAL_STATUSES.has(r.status)) Object.assign(r, { status: "expired", reason: "device removed", updatedAt: now });
    }
    await writeJson(requestsPath(), reqs);
    await logEvent({ kind: "removed", device: id });
    wake(id);
    return true;
  });
}

export function touchDevice(id: string, actions?: ActionInfo[]): Promise<void> {
  return serial(async () => {
    const rows = await listDevices();
    const d = rows.find((x) => x.id === id);
    if (!d) return;
    d.lastSeenAt = Date.now();
    if (actions) d.actions = actions;
    await writeJson(devicesPath(), rows);
  });
}

// ---- replay guard -------------------------------------------------------------

const seenNonces = new Map<string, number>();

/** True once per nonce inside the clock window. */
export function acceptNonce(deviceId: string, nonce: string, ts: number, now = Date.now()): boolean {
  if (!/^[a-f0-9]{32}$/.test(nonce)) return false;
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_CLOCK_SKEW_MS) return false;
  for (const [k, at] of seenNonces) if (at < now - 2 * MAX_CLOCK_SKEW_MS) seenNonces.delete(k);
  const key = `${deviceId}:${nonce}`;
  if (seenNonces.has(key)) return false;
  seenNonces.set(key, now);
  return true;
}

// ---- requests -----------------------------------------------------------------

async function readRequests(): Promise<DeviceRequest[]> {
  const rows = await readJson<unknown>(requestsPath(), []);
  return Array.isArray(rows) ? (rows as DeviceRequest[]) : [];
}

/** How long a request the device has may stay silent before it counts as lost (crash, Ctrl-C, lost reply). */
export const STALE_MS: Partial<Record<RequestStatus, number>> = {
  delivered: 5 * 60_000,
  "waiting-approval": 10 * 60_000, // the device's prompt gives up after 2 minutes
  running: 4 * 60 * 60_000, // the longest grant
};

function expire(rows: DeviceRequest[], now: number): boolean {
  let changed = false;
  for (const r of rows) {
    if (r.status === "queued" && r.expiresAt <= now) {
      Object.assign(r, { status: "expired", reason: "the device did not fetch it in time", updatedAt: now });
      changed = true;
      continue;
    }
    const stale = STALE_MS[r.status];
    if (stale !== undefined && now - r.updatedAt > stale) {
      Object.assign(r, { status: "expired", reason: `the device stopped reporting while ${r.status}`, updatedAt: now });
      changed = true;
    }
  }
  return changed;
}

export async function listRequests(filter: { deviceId?: string; limit?: number } = {}): Promise<DeviceRequest[]> {
  const rows = await serial(async () => {
    const rows = await readRequests();
    if (expire(rows, Date.now())) await writeJson(requestsPath(), rows);
    return rows;
  });
  return rows
    .filter((r) => !filter.deviceId || r.deviceId === filter.deviceId)
    .slice(-(filter.limit ?? 20))
    .reverse();
}

export async function getRequest(id: string): Promise<DeviceRequest | null> {
  const rows = await readRequests();
  const r = rows.find((x) => x.id === id) ?? null;
  if (r && !FINAL_STATUSES.has(r.status)) {
    let changed = false;
    await serial(async () => {
      const all = await readRequests();
      changed = expire(all, Date.now());
      if (changed) await writeJson(requestsPath(), all);
    });
    if (changed) return (await readRequests()).find((x) => x.id === id) ?? null;
  }
  return r;
}

export function createRequest(input: {
  deviceId: string;
  action: string;
  args: Record<string, string>;
  expiresInMs?: number;
  requestedBy?: string;
}): Promise<DeviceRequest> {
  return serial(async () => {
    const device = await getDevice(input.deviceId);
    if (!device) throw new Error(`unknown device "${input.deviceId}"`);
    if (!device.actions.some((a) => a.name === input.action)) {
      throw new Error(`device "${device.id}" has no action "${input.action}". It has: ${device.actions.map((a) => a.name).join(", ") || "none"}`);
    }
    const now = Date.now();
    const rows = await readRequests();
    expire(rows, now);
    const open = rows.filter((r) => r.deviceId === device.id && !FINAL_STATUSES.has(r.status)).length;
    if (open >= MAX_OPEN_PER_DEVICE) throw new Error(`device "${device.id}" already has ${open} open requests`);
    const expiresIn = Math.min(Math.max(input.expiresInMs ?? DEFAULT_EXPIRY_MS, 30_000), MAX_EXPIRY_MS);
    const req: DeviceRequest = {
      id: `dr_${now.toString(36)}${randomBytes(4).toString("hex")}`,
      deviceId: device.id,
      action: input.action,
      args: input.args,
      expiresAt: now + expiresIn,
      requestedBy: input.requestedBy,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      files: [],
    };
    rows.push(req);
    const dropped = rows.length > REQUESTS_KEEP ? rows.splice(0, rows.length - REQUESTS_KEEP) : [];
    await writeJson(requestsPath(), rows);
    for (const d of dropped) await rm(requestFilesDir(d.id), { recursive: true, force: true }).catch(() => {});
    await logEvent({ kind: "requested", device: device.id, request: req.id, action: req.action, requestedBy: req.requestedBy });
    wake(device.id);
    return req;
  });
}

/** Hands the oldest queued request to the device, or null. */
export function takeNext(deviceId: string): Promise<WireRequest | null> {
  return serial(async () => {
    const now = Date.now();
    const rows = await readRequests();
    const changed = expire(rows, now);
    const next = rows.find((r) => r.deviceId === deviceId && r.status === "queued");
    if (next) {
      next.status = "delivered";
      next.updatedAt = now;
    }
    if (next || changed) await writeJson(requestsPath(), rows);
    if (!next) return null;
    await logEvent({ kind: "delivered", device: deviceId, request: next.id });
    return { id: next.id, action: next.action, args: next.args, expiresAt: next.expiresAt, requestedBy: next.requestedBy };
  });
}

const ALLOWED_NEXT: Record<RequestStatus, ReadonlySet<RequestStatus>> = {
  queued: new Set(),
  delivered: new Set(["waiting-approval", "running", "done", "failed", "denied"]),
  "waiting-approval": new Set(["running", "denied", "failed"]),
  running: new Set(["done", "failed"]),
  done: new Set(),
  failed: new Set(),
  denied: new Set(),
  expired: new Set(),
};

export function applyUpdate(deviceId: string, u: WireUpdate): Promise<DeviceRequest> {
  return serial(async () => {
    const rows = await readRequests();
    const r = rows.find((x) => x.id === u.id && x.deviceId === deviceId);
    if (!r) throw new Error("unknown request");
    if (!ALLOWED_NEXT[r.status].has(u.status)) throw new Error(`cannot go from ${r.status} to ${u.status}`);
    r.status = u.status;
    r.updatedAt = Date.now();
    if (typeof u.exitCode === "number" && Number.isInteger(u.exitCode)) r.exitCode = u.exitCode;
    if (typeof u.logTail === "string") r.logTail = u.logTail.slice(-MAX_LOG_TAIL);
    if (typeof u.reason === "string") r.reason = u.reason.slice(0, 500);
    await writeJson(requestsPath(), rows);
    await logEvent({ kind: "status", device: deviceId, request: r.id, status: r.status, exitCode: r.exitCode, reason: r.reason });
    return r;
  });
}

/** Stores one file for a running or finished request, inside its own folder only. */
export function addFile(deviceId: string, requestId: string, name: string, body: Uint8Array): Promise<void> {
  return serial(async () => {
    if (!FILE_NAME_RE.test(name)) throw new Error("bad file name");
    if (body.byteLength > MAX_FILE_BYTES) throw new Error(`file larger than ${MAX_FILE_BYTES} bytes`);
    const rows = await readRequests();
    const r = rows.find((x) => x.id === requestId && x.deviceId === deviceId);
    if (!r) throw new Error("unknown request");
    if (r.status !== "running") throw new Error("files are accepted only while the request runs");
    if (r.files.some((f) => f.name === name)) throw new Error("file already sent");
    if (r.files.length >= MAX_FILES_PER_REQUEST) throw new Error("too many files");
    const total = r.files.reduce((n, f) => n + f.bytes, 0) + body.byteLength;
    if (total > MAX_REQUEST_FILE_BYTES) throw new Error("request file limit reached");
    await mkdir(requestFilesDir(r.id), { recursive: true, mode: 0o700 });
    await Bun.write(join(requestFilesDir(r.id), name), body);
    r.files.push({ name, bytes: body.byteLength });
    r.updatedAt = Date.now();
    await writeJson(requestsPath(), rows);
  });
}

export async function requestFilePaths(requestId: string): Promise<string[]> {
  const names = await readdir(requestFilesDir(requestId)).catch(() => [] as string[]);
  return names.filter((n) => FILE_NAME_RE.test(n)).map((n) => join(requestFilesDir(requestId), n));
}

// ---- long poll ----------------------------------------------------------------

const waiters = new Map<string, Set<() => void>>();

function wake(deviceId: string) {
  const set = waiters.get(deviceId);
  if (!set) return;
  waiters.delete(deviceId);
  for (const fn of set) fn();
}

/** Resolves when a request for this device is queued, or after ms. */
export function waitForWork(deviceId: string, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const set = waiters.get(deviceId) ?? new Set();
    waiters.set(deviceId, set);
    const done = () => {
      clearTimeout(timer);
      set.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    set.add(done);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Resolves when a request reaches a final status, or after ms. For agents that wait for the answer. */
export async function waitForFinal(id: string, ms: number): Promise<DeviceRequest | null> {
  const end = Date.now() + ms;
  for (;;) {
    const r = await getRequest(id);
    if (!r || FINAL_STATUSES.has(r.status) || Date.now() >= end) return r;
    await Bun.sleep(Math.min(1000, Math.max(0, end - Date.now())));
  }
}
