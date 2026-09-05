/**
 * The omg Cloud account this box is signed in to, and the machines on it.
 *
 * One owner for the two reads (`/api/cloud/session`, `/api/cloud/computers`)
 * and the two writes (sign in, sign out), shared by the desktop machine rail
 * and the Settings section. These calls always go to the box that served the
 * page, never through the machine transport: the account lives on that box.
 */

import { useCallback, useEffect, useState } from "react";

import { LOCAL_MACHINE_ID, type MachineChoice } from "./machines";

/** Mirrors CloudAccountStatus in src/cloud-account.ts. */
export type CloudAccountStatus = {
  signedIn: boolean;
  email: string | null;
  expiresAt: number | null;
  kind: "api-key" | "jwt" | "oauth" | null;
  authUrl: string;
};

/** Mirrors CloudComputerRow in src/cloud-account.ts. */
export type CloudComputerRow = {
  slug: string;
  name: string;
  kind: "cloud" | "connected";
  online: boolean;
  status: string;
  isDefault: boolean;
  /** Present on a control plane that reports it; the cloud row is always "cloud". */
  bindingId?: string;
  lastSeenAt?: number | null;
  defaultFolder?: string | null;
};

/** The id the box proxy needs for a row, or null when the server did not say. */
export function rowMachineId(row: Pick<CloudComputerRow, "slug" | "kind" | "bindingId">): string | null {
  if (row.bindingId?.trim()) return row.bindingId.trim();
  if (row.kind === "cloud" || row.slug === "cloud") return "cloud";
  return null;
}

export function rowMachineChoice(row: CloudComputerRow): MachineChoice | null {
  const id = rowMachineId(row);
  return id ? { id, name: row.name } : null;
}

export const LOCAL_MACHINE_CHOICE: MachineChoice = { id: LOCAL_MACHINE_ID, name: "This computer" };

export function machineStatusLabel(row: Pick<CloudComputerRow, "online" | "status">): string {
  if (row.online) return "Online";
  switch (row.status) {
    case "provisioning":
      return "Setting up";
    case "paused":
      return "Paused";
    case "waking":
      return "Waking";
    case "recycled":
      return "Removed";
    case "upgrade_required":
      return "Needs upgrade";
    case "none":
      return "Not created yet";
    case "offline":
      return "Offline";
    default:
      return row.status.replace(/_/g, " ");
  }
}

async function readJson<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null;
}

export type CloudMachinesState = {
  /** Null until the first answer, and null forever on a server without the routes. */
  status: CloudAccountStatus | null;
  computers: CloudComputerRow[] | null;
  error: string | null;
  busy: boolean;
  reload: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

export function useCloudMachines(): CloudMachinesState {
  const [status, setStatus] = useState<CloudAccountStatus | null>(null);
  const [computers, setComputers] = useState<CloudComputerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const session = await fetch("/api/cloud/session", { credentials: "same-origin", signal });
    if (!session.ok) throw new Error(`Cloud session request failed (${session.status})`);
    const next = (await session.json()) as CloudAccountStatus;
    setStatus(next);
    if (!next.signedIn) {
      setComputers(null);
      return;
    }
    const list = await fetch("/api/cloud/computers", { credentials: "same-origin", signal });
    const body = await readJson<{ computers?: CloudComputerRow[]; error?: string }>(list);
    if (!list.ok) throw new Error(body?.error ?? `Computer list failed (${list.status})`);
    setComputers(body?.computers ?? []);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((e: unknown) => {
      if (controller.signal.aborted) return;
      // An older server has no /api/cloud routes. `status` stays null and the
      // callers hide themselves instead of showing a permanent error row.
      if (e instanceof Error && !/session request failed/.test(e.message)) setError(e.message);
    });
    return () => controller.abort();
  }, [load]);

  const reload = useCallback(async () => {
    setError(null);
    try {
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your computers.");
    }
  }, [load]);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/cloud/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: `${window.location.pathname}${window.location.search}` }),
      });
      const body = await readJson<{ authorizeUrl?: string; error?: string }>(response);
      if (!response.ok || !body?.authorizeUrl) {
        throw new Error(body?.error ?? `Sign-in could not start (${response.status})`);
      }
      window.location.assign(body.authorizeUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in could not start.");
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/cloud/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error(`Sign-out failed (${response.status})`);
      setComputers(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-out failed.");
    } finally {
      setBusy(false);
    }
  }, [load]);

  return { status, computers, error, busy, reload, signIn, signOut };
}
