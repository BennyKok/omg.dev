// The wire contract between `omg serve` and a linked device (`omg device`).
// Both sides import only this file from each other, so it must stay free of
// server-only imports (no PATHS, no Bun-only APIs): the device side runs it on
// another machine.
//
// Every device call is signed with the device's Ed25519 key. The signed string
// binds the method, path, time, a one-use nonce and the body hash, so a captured
// call cannot be replayed, retargeted or given a different body.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";

export const LINK_PREFIX = "/api/devices/link/";
export const MAX_CLOCK_SKEW_MS = 120_000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_REQUEST_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 20;
export const MAX_LOG_TAIL = 16 * 1024;
export const POLL_WAIT_MS = 25_000;

export type Approval = "in-grant" | "once-per-grant" | "each";
export const APPROVALS: readonly Approval[] = ["in-grant", "once-per-grant", "each"];

/** One argument rule. Values are always strings on the wire. */
export type ArgSpec = { pattern?: string; enum?: string[]; maxLength?: number; optional?: boolean; allowDash?: boolean };

/** What a device tells the server it can do. The device's own config decides; this is a copy for listing. */
export type ActionInfo = { name: string; approval: Approval; args: Record<string, ArgSpec>; description?: string };

export type RequestStatus =
  | "queued" // waiting for the device to fetch it
  | "delivered" // the device has it
  | "waiting-approval" // the device is asking its user
  | "running"
  | "done"
  | "failed"
  | "denied"
  | "expired";

export const FINAL_STATUSES: ReadonlySet<RequestStatus> = new Set(["done", "failed", "denied", "expired"]);

/** What the device receives. */
export type WireRequest = { id: string; action: string; args: Record<string, string>; expiresAt: number; requestedBy?: string };

/** What the device reports. */
export type WireUpdate = {
  id: string;
  status: Exclude<RequestStatus, "queued" | "delivered" | "expired">;
  exitCode?: number;
  logTail?: string;
  reason?: string;
};

export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const ACTION_RE = /^[a-z][a-z0-9_]{0,39}$/;
/** Server-made request ids. The device uses one as a folder name, so it checks this before anything else. */
export const REQUEST_ID_RE = /^dr_[a-z0-9]{1,40}$/;
export const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function sha256Hex(body: Uint8Array | string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function signedString(method: string, path: string, ts: string, nonce: string, bodyHash: string): string {
  return ["omg-device-v1", method.toUpperCase(), path, ts, nonce, bodyHash].join("\n");
}

export function newKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

/** Accepts only an Ed25519 SPKI PEM. Returns the normalized PEM, or null. */
export function normalizePublicKey(pem: unknown): string | null {
  if (typeof pem !== "string" || pem.length > 1000) return null;
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ed25519") return null;
    return key.export({ type: "spki", format: "pem" }).toString();
  } catch {
    return null;
  }
}

export type SignedHeaders = {
  "x-omg-device": string;
  "x-omg-device-ts": string;
  "x-omg-device-nonce": string;
  "x-omg-device-sig": string;
};

export function signRequest(
  deviceId: string,
  privateKeyPem: string,
  method: string,
  path: string,
  body: Uint8Array | string,
  now = Date.now(),
): SignedHeaders {
  const ts = String(now);
  const nonce = randomBytes(16).toString("hex");
  const data = Buffer.from(signedString(method, path, ts, nonce, sha256Hex(body)));
  const sig = sign(null, data, createPrivateKey(privateKeyPem)).toString("base64");
  return { "x-omg-device": deviceId, "x-omg-device-ts": ts, "x-omg-device-nonce": nonce, "x-omg-device-sig": sig };
}

export function verifySignature(
  publicKeyPem: string,
  method: string,
  path: string,
  ts: string,
  nonce: string,
  body: Uint8Array | string,
  sigB64: string,
): boolean {
  try {
    const data = Buffer.from(signedString(method, path, ts, nonce, sha256Hex(body)));
    return verify(null, data, createPublicKey(publicKeyPem), Buffer.from(sigB64, "base64"));
  } catch {
    return false;
  }
}

/** Checks one value against its rule. Returns an error message, or null. */
export function checkArg(name: string, value: unknown, spec: ArgSpec): string | null {
  if (value === undefined || value === "") return spec.optional ? null : `${name}: required`;
  if (typeof value !== "string") return `${name}: must be a string`;
  if (value.length > (spec.maxLength ?? 200)) return `${name}: longer than ${spec.maxLength ?? 200}`;
  if (/[\0\r\n]/.test(value)) return `${name}: control characters are not allowed`;
  // A value can fill a whole argument, so a leading dash would read as an option.
  if (value.startsWith("-") && !spec.allowDash) return `${name}: may not start with "-"`;
  if (spec.enum && !spec.enum.includes(value)) return `${name}: one of ${spec.enum.join(", ")}`;
  if (spec.pattern && !new RegExp(`^(?:${spec.pattern})$`).test(value)) return `${name}: does not match ${spec.pattern}`;
  return null;
}

/** Checks a full argument set: no unknown names, every rule holds. */
export function checkArgs(args: unknown, specs: Record<string, ArgSpec>): { ok: true; args: Record<string, string> } | { ok: false; error: string } {
  const input = args ?? {};
  if (typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "args must be an object" };
  const out: Record<string, string> = {};
  for (const key of Object.keys(input)) {
    if (!(key in specs)) return { ok: false, error: `unknown argument ${JSON.stringify(key.slice(0, 40))}` };
  }
  for (const [name, spec] of Object.entries(specs)) {
    const value = (input as Record<string, unknown>)[name];
    const problem = checkArg(name, value, spec);
    if (problem) return { ok: false, error: problem };
    if (typeof value === "string" && value !== "") out[name] = value;
  }
  return { ok: true, args: out };
}
