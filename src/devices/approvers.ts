// The phones the person added at this device, and the checks a remote decision
// must pass before the device acts on it. Device side only: this file runs on the
// linked machine, and only the person at it can add a phone (the code that proves
// a phone read this screen is made here and never sent to the server).
//
//   ~/.omg-device/approvers.json   [{ id, name, x, y, addedAt }]  (public keys)
//   ~/.omg-device/state.json       remoteNonces: nonces already used, by time
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deviceHome } from "./agent.ts";
import {
  approverIdFor,
  argsDigest,
  enrolmentProof,
  REMOTE_WINDOW_MS,
  validApproverKey,
  validDecisionShape,
  validEnrolmentShape,
  verifyApproval,
  type ApproverKey,
  type WireApprover,
  type WireEnrolment,
  type WireRemoteDecision,
} from "./protocol.ts";

export type Approver = WireApprover & ApproverKey;

const approversPath = () => join(deviceHome(), "approvers.json");
const noncesPath = () => join(deviceHome(), "remote-nonces.json");
export const INVITE_TTL_MS = 10 * 60_000;
const MAX_APPROVERS = 10;

export function loadApprovers(): Approver[] {
  try {
    const rows = JSON.parse(readFileSync(approversPath(), "utf8"));
    if (!Array.isArray(rows)) return [];
    return (rows as Approver[]).filter((a) => !!a && typeof a.id === "string" && typeof a.name === "string" && validApproverKey({ x: a.x, y: a.y }) && approverIdFor(a) === a.id).slice(0, MAX_APPROVERS);
  } catch {
    return [];
  }
}

function saveApprovers(rows: Approver[]) {
  mkdirSync(deviceHome(), { recursive: true, mode: 0o700 });
  writeFileSync(approversPath(), JSON.stringify(rows, null, 2) + "\n", { mode: 0o600 });
}

export function removeApprover(id: string): boolean {
  const rows = loadApprovers();
  if (!rows.some((a) => a.id === id)) return false;
  saveApprovers(rows.filter((a) => a.id !== id));
  return true;
}

/** The public view: what the device tells the server and shows the person. */
export function approverList(): WireApprover[] {
  return loadApprovers().map(({ id, name, addedAt }) => ({ id, name, addedAt }));
}

// ---- invites: the code a phone scans at this screen ---------------------------------

export type Invite = { code: string; expiresAt: number };

export function newInvite(now = Date.now()): Invite {
  // 20 characters of base32: 100 bits, shown only on this screen, once, for ten minutes.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (const b of randomBytes(20)) code += alphabet[b % alphabet.length];
  return { code, expiresAt: now + INVITE_TTL_MS };
}

/** What the phone's camera reads: which device, on which controller, and the code. */
export function invitePayload(invite: Invite, deviceId: string, server: string): string {
  return JSON.stringify({ omg: "approver", v: 1, device: deviceId, server, code: invite.code });
}

/** Adds the phone when its enrolment carries a proof made with the open invite. Returns the approver or why not. */
export function acceptEnrolment(raw: unknown, deviceId: string, invite: Invite | null, now = Date.now()): { ok: true; approver: Approver } | { ok: false; reason: string } {
  if (!validEnrolmentShape(raw)) return { ok: false, reason: "malformed enrolment" };
  const e = raw as WireEnrolment;
  if (e.device !== deviceId) return { ok: false, reason: "this enrolment is for another device" };
  if (!invite || now >= invite.expiresAt) return { ok: false, reason: "no open invite on the device: show the code there again" };
  const { proof, ...rest } = e;
  const want = Buffer.from(enrolmentProof(invite.code, rest), "hex");
  const given = Buffer.from(proof, "hex");
  if (want.length !== given.length || !timingSafeEqual(want, given)) return { ok: false, reason: "the code does not match the one on the device" };
  const key = { x: e.x, y: e.y };
  const approver: Approver = { id: approverIdFor(key), name: e.name.trim(), addedAt: now, ...key };
  const rows = loadApprovers().filter((a) => a.id !== approver.id);
  if (rows.length >= MAX_APPROVERS) return { ok: false, reason: `at most ${MAX_APPROVERS} phones` };
  saveApprovers([...rows, approver]);
  return { ok: true, approver };
}

// ---- decisions -------------------------------------------------------------------

function loadNonces(): Record<string, number> {
  try {
    const raw = JSON.parse(readFileSync(noncesPath(), "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** True once per nonce. Kept on disk, so a restart inside the window cannot replay a decision. */
export function useNonce(nonce: string, now = Date.now()): boolean {
  const all = loadNonces();
  for (const [k, at] of Object.entries(all)) if (typeof at !== "number" || at < now - 2 * REMOTE_WINDOW_MS) delete all[k];
  if (all[nonce]) return false;
  all[nonce] = now;
  try {
    mkdirSync(deviceHome(), { recursive: true, mode: 0o700 });
    writeFileSync(noncesPath(), JSON.stringify(all) + "\n", { mode: 0o600 });
  } catch {
    // Without a record the decision cannot be proven unused: refuse it.
    return false;
  }
  return true;
}

/**
 * Everything about a decision that does not depend on what is waiting: shape,
 * device, a known approver, its signature, the time window and a fresh nonce.
 * Returns the approver, or why not.
 */
export function checkDecision(raw: unknown, deviceId: string, now = Date.now()): { ok: true; approver: Approver; decision: WireRemoteDecision } | { ok: false; reason: string } {
  if (!validDecisionShape(raw)) return { ok: false, reason: "malformed decision" };
  const d = raw as WireRemoteDecision;
  if (d.device !== deviceId) return { ok: false, reason: "this decision is for another device" };
  const approver = loadApprovers().find((a) => a.id === d.approver);
  if (!approver) return { ok: false, reason: "this phone is not an approver on the device" };
  if (!verifyApproval(approver, d)) return { ok: false, reason: "the signature does not check out" };
  if (Math.abs(now - d.issuedAt) > REMOTE_WINDOW_MS) return { ok: false, reason: "the decision is too old (or the phone's clock is off)" };
  if (!useNonce(d.nonce, now)) return { ok: false, reason: "this decision was already used" };
  return { ok: true, approver, decision: d };
}

export function requestDetail(action: string, args: Record<string, string>): string {
  return `${action}\n${argsDigest(args)}`;
}
