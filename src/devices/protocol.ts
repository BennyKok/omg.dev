// The wire contract between `omg serve` and a linked device (`omg device`).
// Both sides import only this file from each other, so it must stay free of
// server-only imports (no PATHS, no Bun-only APIs): the device side runs it on
// another machine.
//
// Every device call is signed with the device's Ed25519 key. The signed string
// binds the method, path, time, a one-use nonce and the body hash, so a captured
// call cannot be replayed, retargeted or given a different body.

import { createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";

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
/** Passive receiver overview. Reading this never delivers or runs a request. */
export type WireRequestState = WireRequest & { status: RequestStatus };

/** What the device reports. */
export type WireUpdate = {
  id: string;
  status: Exclude<RequestStatus, "queued" | "delivered" | "expired">;
  exitCode?: number;
  logTail?: string;
  reason?: string;
};

/** The device's own grant, as it reports it. The server shows this to agents; it never sets it. */
export type WireGrant = {
  startedAt: number;
  endsAt: number;
  /** null: no idle timeout while the grant lasts. */
  idleMinutes: number | null;
  /** When the grant stops for idleness. null while an action runs, or with no idle timeout. */
  idleEndsAt: number | null;
  busy: boolean;
  /** The most one decision at the device may allow, in minutes. */
  ceilingMinutes: number;
};

/** An agent asks for more time. Only the person at the device can approve it. */
export type WireExtension = { id: string; minutes: number; reason?: string; requestedBy?: string; createdAt: number; expiresAt: number };

/** Heartbeat from the device while it owns a grant, and once when the grant ends. */
export type WireGrantReport = {
  grant: WireGrant | null;
  /** Why the grant ended, when grant is null. */
  reason?: string;
  /** The device's answer to an extension request. */
  extension?: { id: string; status: "approved" | "denied"; endsAt?: number; reason?: string };
};

/** A request that ended without reaching a running grant, for the person at the device. */
export type WireMissedRequest = { id: string; action: string; requestedBy?: string; reason?: string; createdAt: number; updatedAt: number };

export const MAX_EXTENSION_MINUTES = 24 * 60;
export const EXTENSION_ID_RE = /^dx_[a-z0-9]{1,40}$/;

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

// ---- approvers: phones the person added at the device ------------------------------
//
// A phone the person enrolled at the device (by scanning a code shown there) can
// answer for them from anywhere: approve or deny a waiting action or extension,
// start access, stop it. The phone holds a P-256 key that never leaves it (the
// iPhone's Secure Enclave, behind Face ID) and signs each decision. The server
// only carries the decision; the DEVICE checks the signature against the keys it
// enrolled itself, the time, a one-use nonce, and that the decision names exactly
// what is waiting there (the request id, its action and the digest of its
// arguments). A server, or an agent on it, can relay decisions but never make one.

export const APPROVER_ID_RE = /^ap_[a-f0-9]{16}$/;
export const APPROVER_NAME_MAX = 60;
/** A decision is good for this long after the phone signed it (and that long before, for clock skew). */
export const REMOTE_WINDOW_MS = 3 * 60_000;
const B64URL_RE = /^[A-Za-z0-9_-]{43}$/;

export type ApproverKey = { x: string; y: string };
/** What a device reports about its approvers (no keys: the server never needs them). */
export type WireApprover = { id: string; name: string; addedAt: number };
export type RemoteKind = "request" | "extension" | "start" | "stop";
export const REMOTE_KINDS: readonly RemoteKind[] = ["request", "extension", "start", "stop"];

/**
 * One decision from an approver's phone. `detail` binds what was decided:
 *   request:   "<action>\n<argsDigest(args)>"
 *   extension: "<minutes>"
 *   start:     "<minutes>,<idle minutes or never>"
 *   stop:      ""
 */
export type WireRemoteDecision = {
  device: string;
  approver: string;
  kind: RemoteKind;
  target: string;
  allow: boolean;
  detail: string;
  issuedAt: number;
  nonce: string;
  /** base64 DER ECDSA P-256 SHA-256 over approvalString(). */
  sig: string;
};

/** A phone asks to become an approver. `proof` shows it read the code on the device's screen. */
export type WireEnrolment = { device: string; name: string; x: string; y: string; nonce: string; proof: string };
/** What the device made of a decision or an enrolment, by nonce. */
export type WireRemoteResult = { nonce: string; ok: boolean; reason?: string };

/** Arguments in one canonical form: sorted "key=value" lines (values never hold a newline). */
export function argsDigest(args: Record<string, string>): string {
  return sha256Hex(Object.keys(args).sort().map((k) => `${k}=${args[k]}`).join("\n"));
}

export function approvalString(d: Omit<WireRemoteDecision, "sig">): string {
  return ["omg-approve-v1", d.device, d.approver, d.kind, d.target, d.allow ? "allow" : "deny", d.detail, String(d.issuedAt), d.nonce].join("\n");
}

export function enrolmentString(e: Omit<WireEnrolment, "proof">): string {
  return ["omg-approver-v1", e.device, e.name, e.x, e.y, e.nonce].join("\n");
}

/** HMAC-SHA256 of the enrolment under the code the device showed, hex. */
export function enrolmentProof(code: string, e: Omit<WireEnrolment, "proof">): string {
  return createHmac("sha256", code).update(enrolmentString(e)).digest("hex");
}

export function validApproverKey(k: unknown): k is ApproverKey {
  if (!k || typeof k !== "object") return false;
  const { x, y } = k as Record<string, unknown>;
  if (typeof x !== "string" || typeof y !== "string" || !B64URL_RE.test(x) || !B64URL_RE.test(y)) return false;
  try {
    createPublicKey({ key: { kty: "EC", crv: "P-256", x, y }, format: "jwk" });
    return true;
  } catch {
    return false;
  }
}

/** A short, stable id for a key: "ap_" and 16 hex of sha256(x||y). */
export function approverIdFor(k: ApproverKey): string {
  return `ap_${createHash("sha256").update(Buffer.from(k.x, "base64url")).update(Buffer.from(k.y, "base64url")).digest("hex").slice(0, 16)}`;
}

export function verifyApproval(k: ApproverKey, d: WireRemoteDecision): boolean {
  try {
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: k.x, y: k.y }, format: "jwk" });
    const { sig, ...signed } = d;
    return verify("sha256", Buffer.from(approvalString(signed)), { key, dsaEncoding: "der" }, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
}

/** Shape only, for both sides. The device still checks everything that matters. */
export function validDecisionShape(raw: unknown): raw is WireRemoteDecision {
  if (!raw || typeof raw !== "object") return false;
  const d = raw as Record<string, unknown>;
  return typeof d.device === "string" && NAME_RE.test(d.device)
    && typeof d.approver === "string" && APPROVER_ID_RE.test(d.approver)
    && typeof d.kind === "string" && REMOTE_KINDS.includes(d.kind as RemoteKind)
    && typeof d.target === "string" && d.target.length <= 60
    && typeof d.allow === "boolean"
    && typeof d.detail === "string" && d.detail.length <= 200
    && typeof d.issuedAt === "number" && Number.isFinite(d.issuedAt)
    && typeof d.nonce === "string" && /^[a-f0-9]{32}$/.test(d.nonce)
    && typeof d.sig === "string" && d.sig.length <= 200;
}

export function validEnrolmentShape(raw: unknown): raw is WireEnrolment {
  if (!raw || typeof raw !== "object") return false;
  const e = raw as Record<string, unknown>;
  return typeof e.device === "string" && NAME_RE.test(e.device)
    && typeof e.name === "string" && e.name.trim().length > 0 && e.name.length <= APPROVER_NAME_MAX && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(e.name)
    && validApproverKey({ x: e.x, y: e.y })
    && typeof e.nonce === "string" && /^[a-f0-9]{32}$/.test(e.nonce)
    && typeof e.proof === "string" && /^[a-f0-9]{64}$/.test(e.proof);
}
