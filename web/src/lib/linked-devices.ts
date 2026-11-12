/**
 * Linked devices (`omg device`, server side in src/devices/) for the web UI.
 *
 * One cached copy of `GET /api/devices` serves both the Settings section and
 * the composer's `@` picker, so typing `@` never waits on the network. The
 * cache refreshes when it is older than a minute and after any change made
 * from this UI.
 */

import { useEffect, useSyncExternalStore } from "react";

export type DeviceApproval = "in-grant" | "once-per-grant" | "each";

export type LinkedDevice = {
  id: string;
  tailnetIp?: string;
  pairedAt: number;
  lastSeenAt?: number;
  actions: Array<{ name: string; approval: DeviceApproval; description?: string }>;
};

export type DeviceRequestRow = {
  id: string;
  device: string;
  action: string;
  requestedBy?: string;
  status: string;
  reason?: string;
  createdAt: number;
  updatedAt: number;
  args?: Record<string, string>;
  exitCode?: number;
  untrustedOutput?: string;
  files?: Array<{ name: string; bytes: number }>;
};

type Snapshot = { devices: LinkedDevice[]; requests: DeviceRequestRow[]; loaded: boolean; unavailable: boolean };

const EMPTY: Snapshot = { devices: [], requests: [], loaded: false, unavailable: false };
const STALE_MS = 60_000;

let snapshot: Snapshot = EMPTY;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const fn of listeners) fn();
}

export function refreshLinkedDevices(): Promise<void> {
  if (inflight) return inflight;
  inflight = fetch("/api/devices", { credentials: "same-origin" })
    .then(async (res) => {
      // An older server has no device routes, and a bot session is refused.
      // Either way there is nothing to offer, which is not an error to show.
      if (!res.ok) return publish({ ...EMPTY, loaded: true, unavailable: true });
      const body = (await res.json()) as { devices?: LinkedDevice[]; requests?: DeviceRequestRow[] };
      publish({ devices: body.devices ?? [], requests: body.requests ?? [], loaded: true, unavailable: false });
    })
    .catch(() => publish({ ...snapshot, loaded: true }))
    .finally(() => {
      fetchedAt = Date.now();
      inflight = null;
    });
  return inflight;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The cached device list. Mounting a user refreshes it when stale. */
export function useLinkedDevices(live = false): Snapshot {
  const value = useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
  useEffect(() => {
    if (Date.now() - fetchedAt > STALE_MS) void refreshLinkedDevices();
  }, []);
  useEffect(() => {
    if (!live) return;
    void refreshLinkedDevices();
    const refresh = () => { if (document.visibilityState !== "hidden") void refreshLinkedDevices(); };
    const timer = window.setInterval(refresh, 3000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [live]);
  return value;
}

export const approvalLabels: Record<DeviceApproval, string> = {
  "in-grant": "Allowed during access",
  "once-per-grant": "Ask on first use",
  each: "Ask every time",
};

export type ReceiverState = {
  deviceId: string | null;
  server: string | null;
  active: boolean;
  otherProcess?: boolean;
  endsAt: number | null;
  idleMinutes: number | null;
  actions: LinkedDevice["actions"];
  error: string | null;
  requests?: Array<{ id: string; action: string; args: Record<string, string>; requestedBy?: string; status: string; expiresAt: number }>;
  queueError?: string | null;
  pending: {
    token: string;
    request: { id: string; action: string; args: Record<string, string>; requestedBy?: string };
    argv: string[];
    approval: DeviceApproval;
    expiresAt: number;
  } | null;
  activity: Array<{
    at: number;
    kind: string;
    reason?: string;
    request?: { id: string; action: string; args: Record<string, string> };
    update?: { reason?: string; exitCode?: number; logTail?: string };
  }>;
};

export async function receiverRequest(action?: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<ReceiverState> {
  const res = await fetch(`/api/devices/_local${action ? `/${action}` : ""}`, {
    method: action ? "POST" : "GET", credentials: "same-origin", signal,
    ...(action ? { headers: { "content-type": "application/json", "x-omg-device-ui": "1" }, body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Device access failed (${res.status})`);
  return data as ReceiverState;
}

/** The picker's hint line: what the device can do. */
export function deviceMentionHint(device: LinkedDevice): string {
  const names = device.actions.map((a) => a.name);
  const shown = names.slice(0, 4).join(", ");
  return `Linked device${names.length ? ` · ${shown}${names.length > 4 ? `, +${names.length - 4}` : ""}` : ""}`;
}

/** A short "seen 3 min ago" for a device row. */
export function lastSeenLabel(at: number | undefined, now = Date.now()): string {
  if (!at) return "Never connected";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "Connected now";
  const m = Math.round(s / 60);
  if (m < 60) return `Seen ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `Seen ${h} h ago`;
  return `Seen ${Math.round(h / 24)} days ago`;
}

export type PairingCode = { code: string; name: string; expiresAt: number; server: string | null };

/** The command the person runs on the device. */
export function linkCommand(p: PairingCode): string {
  return `omg device link --server ${p.server || "https://<this computer's tailnet name>"} --code ${p.code}`;
}

export async function createPairingCode(name: string): Promise<PairingCode> {
  const res = await fetch("/api/devices/pairing", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<PairingCode> & { error?: string };
  if (!res.ok || !body.code) throw new Error(body.error || `Pairing failed (${res.status})`);
  return { code: body.code, name: body.name ?? name, expiresAt: body.expiresAt ?? Date.now(), server: body.server ?? null };
}

export async function removeLinkedDevice(id: string): Promise<void> {
  const res = await fetch(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Remove failed (${res.status})`);
  }
  await refreshLinkedDevices();
}
