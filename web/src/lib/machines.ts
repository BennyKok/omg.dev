import { createSameOriginTransport, type OmgTransport } from "@omg-dev/client";
import { useCallback, useEffect, useState } from "react";

/**
 * The linked machine the UI is pointed at. Not "omg:machine": that key held
 * choices from the removed omg Cloud switcher, and main.tsx clears it.
 */
export const MACHINE_STORAGE_KEY = "omg:peer-machine";
export const UNIFIED_FLEET_STORAGE_KEY = "omg:unified-fleet";

/** The box that served the page. */
export const LOCAL_MACHINE_ID = "local";

export const PEER_MACHINES_PREFIX = "/api/peers/machines/";

export type MachineChoice = {
  id: string;
  /** Shown in the rail and the picker. */
  name: string;
};

export type SelfPeerInfo = {
  id: "local";
  name: string;
  localUrl: string;
  tailscaleUrl: string | null;
  /** Whether other omg.dev boxes may link to this one. Off by default. */
  inboundEnabled: boolean;
  /** `<url>#<token>`, a full-control credential. Null while inbound access is off. */
  pairingCode: string | null;
};

export type LinkedPeerInfo = {
  id: string;
  name: string;
  url: string;
  addedAt: number;
  hasToken: boolean;
};

export type PeerFleetSessionRow = Record<string, unknown> & {
  sessionId: string | null;
  peerId: string;
  peerName: string;
};

export type PeerFleetNodeInfo = {
  id: string;
  name: string;
  url: string;
  online: boolean;
  error?: string;
  sessionCount: number;
  busyCount: number;
  sessions: PeerFleetSessionRow[];
};

function storage(): Storage | null {
  try {
    const g = globalThis as { localStorage?: Storage; window?: { localStorage?: Storage } };
    return g.window?.localStorage ?? g.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The stored choice, or the local box. */
export function activeMachine(store: Storage | null = storage()): MachineChoice {
  try {
    const raw = store?.getItem(MACHINE_STORAGE_KEY);
    if (!raw) return { id: LOCAL_MACHINE_ID, name: "This computer" };
    const parsed = JSON.parse(raw) as Partial<MachineChoice>;
    if (typeof parsed.id !== "string" || !parsed.id.trim() || parsed.id === LOCAL_MACHINE_ID) {
      return { id: LOCAL_MACHINE_ID, name: "This computer" };
    }
    return {
      id: parsed.id.trim(),
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : parsed.id.trim(),
    };
  } catch {
    return { id: LOCAL_MACHINE_ID, name: "This computer" };
  }
}

export function isLocalMachine(choice: MachineChoice = activeMachine()): boolean {
  return choice.id === LOCAL_MACHINE_ID;
}

/** The API prefix for a machine, or "" for the local box. */
export function machineBasePath(id: string): string {
  return id === LOCAL_MACHINE_ID ? "" : `${PEER_MACHINES_PREFIX}${encodeURIComponent(id)}`;
}

/** The transport the app should boot with for the stored choice. */
export function machineTransport(choice: MachineChoice = activeMachine()): OmgTransport {
  return createSameOriginTransport({ basePath: machineBasePath(choice.id) });
}

/**
 * Whether the session rail merges sessions from all linked machines ("Unified fleet").
 * Defaults to true so linked machines appear together in the sidebar out of the box.
 */
export function isUnifiedFleetEnabled(store: Storage | null = storage()): boolean {
  try {
    const raw = store?.getItem(UNIFIED_FLEET_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

export function setUnifiedFleetEnabled(
  enabled: boolean,
  store: Storage | null = storage(),
): void {
  try {
    store?.setItem(UNIFIED_FLEET_STORAGE_KEY, enabled ? "1" : "0");
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("omg:peers-changed"));
    }
  } catch {
    // Private mode
  }
}

/**
 * Persist a machine choice and reload so the app boots against the selected
 * machine's transport. When `sessionId` is supplied (for example when clicking
 * a remote session row in the unified sidebar), navigates to `/?session=<id>`
 * so the target session opens immediately after the switch.
 */
export function selectMachine(
  choice: MachineChoice,
  {
    sessionId = null,
    store = storage(),
    reload,
  }: {
    sessionId?: string | null;
    store?: Storage | null;
    reload?: () => void;
  } = {},
): void {
  const current = activeMachine(store);
  if (current.id === choice.id && !sessionId) return;
  try {
    if (choice.id === LOCAL_MACHINE_ID) store?.removeItem(MACHINE_STORAGE_KEY);
    else store?.setItem(MACHINE_STORAGE_KEY, JSON.stringify({ id: choice.id, name: choice.name }));
  } catch {
    // Private mode: the choice lasts until the reload only.
  }
  if (reload) {
    reload();
    return;
  }
  if (typeof window !== "undefined") {
    if (sessionId) {
      window.location.assign(`/?session=${encodeURIComponent(sessionId)}`);
      return;
    }
    if (window.location.pathname.startsWith("/sessions/")) {
      window.location.assign("/");
      return;
    }
    window.location.reload();
  }
}

export function notifyPeersChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("omg:peers-changed"));
  }
}

type PeersSnapshot = {
  self: SelfPeerInfo | null;
  peers: LinkedPeerInfo[];
  fleetNodes: PeerFleetNodeInfo[];
  fleetSessions: PeerFleetSessionRow[];
  unified: boolean;
  loading: boolean;
};

/**
 * Reads `/api/peers` and `/api/peers/fleet` directly from the host origin (not
 * through `omgTransport`), so the machine list and unified session fleet remain
 * available even while the UI transport is switched onto a remote peer.
 */
export function usePeerMachines(enabled = true) {
  const [snapshot, setSnapshot] = useState<PeersSnapshot>(() => ({
    self: null,
    peers: [],
    fleetNodes: [],
    fleetSessions: [],
    unified: isUnifiedFleetEnabled(),
    loading: false,
  }));

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch("/api/peers", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        self?: SelfPeerInfo;
        peers?: LinkedPeerInfo[];
      };
      const self = data.self ?? null;
      const peers = Array.isArray(data.peers) ? data.peers : [];
      const current = activeMachine();

      // If the stored machine was unlinked, return to the local box.
      if (current.id !== LOCAL_MACHINE_ID && !peers.some((p) => p.id === current.id)) {
        selectMachine({ id: LOCAL_MACHINE_ID, name: self?.name || "This computer" });
        return;
      }

      if (peers.length === 0) {
        setSnapshot((prev) => ({
          ...prev,
          self,
          peers: [],
          fleetNodes: [],
          fleetSessions: [],
          unified: isUnifiedFleetEnabled(),
        }));
        return;
      }

      const [fleetRes, localSessionsRes] = await Promise.all([
        fetch("/api/peers/fleet", { credentials: "same-origin", cache: "no-store" }).catch(() => null),
        current.id !== LOCAL_MACHINE_ID
          ? fetch("/api/sessions", { credentials: "same-origin", cache: "no-store" }).catch(() => null)
          : Promise.resolve(null),
      ]);

      const fleetData =
        fleetRes && fleetRes.ok
          ? ((await fleetRes.json().catch(() => null)) as {
              peers?: PeerFleetNodeInfo[];
              sessions?: PeerFleetSessionRow[];
            } | null)
          : null;

      const localSessionsData =
        localSessionsRes && localSessionsRes.ok
          ? ((await localSessionsRes.json().catch(() => null)) as {
              sessions?: Array<Record<string, unknown>>;
            } | null)
          : null;

      const fleetNodes = Array.isArray(fleetData?.peers) ? fleetData.peers : [];
      const rawRemoteSessions = Array.isArray(fleetData?.sessions) ? fleetData.sessions : [];

      // Exclude the currently active machine's own sessions from fleetSessions
      // because App.tsx already loads the active machine's sessions via omgTransport.
      const otherRemoteSessions = rawRemoteSessions.filter((s) => s.peerId !== current.id);
      const localTaggedSessions: PeerFleetSessionRow[] =
        current.id !== LOCAL_MACHINE_ID && Array.isArray(localSessionsData?.sessions)
          ? localSessionsData.sessions
              .filter(
                (s): s is Record<string, unknown> & { sessionId: string } =>
                  Boolean(s && typeof s === "object" && typeof s.sessionId === "string" && s.sessionId),
              )
              .map((s) => ({
                ...s,
                peerId: LOCAL_MACHINE_ID,
                peerName: self?.name || "This computer",
              }))
          : [];

      setSnapshot({
        self,
        peers,
        fleetNodes,
        fleetSessions: [...localTaggedSessions, ...otherRemoteSessions],
        unified: isUnifiedFleetEnabled(),
        loading: false,
      });
    } catch {
      // Ignore transient poll errors.
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    const onPeersChanged = () => {
      setSnapshot((prev) => ({ ...prev, unified: isUnifiedFleetEnabled() }));
      void reload();
    };
    window.addEventListener("omg:peers-changed", onPeersChanged);
    return () => {
      window.removeEventListener("omg:peers-changed", onPeersChanged);
    };
  }, [enabled, reload]);

  useEffect(() => {
    if (!enabled || snapshot.peers.length === 0) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void reload();
    }, 6_000);
    return () => window.clearInterval(timer);
  }, [enabled, snapshot.peers.length, reload]);

  const setUnified = useCallback((next: boolean) => {
    setUnifiedFleetEnabled(next);
    setSnapshot((prev) => ({ ...prev, unified: next }));
  }, []);

  const addPeer = useCallback(
    async (input: {
      pairingCode?: string;
      url?: string;
      token?: string;
      name?: string;
      allowOffline?: boolean;
    }): Promise<{ ok: true; peer: LinkedPeerInfo } | { ok: false; error: string; unreachable?: boolean }> => {
      try {
        const res = await fetch("/api/peers", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          peer?: LinkedPeerInfo;
          error?: string;
          unreachable?: boolean;
        };
        if (!res.ok || !body.peer) {
          return {
            ok: false,
            error: body.error || `Failed to link machine (${res.status})`,
            unreachable: body.unreachable,
          };
        }
        notifyPeersChanged();
        await reload();
        return { ok: true, peer: body.peer };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Network error while linking machine.",
        };
      }
    },
    [reload],
  );

  const renamePeer = useCallback(
    async (id: string, name: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch("/api/peers", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return { ok: false, error: body.error || "Could not rename machine." };
      const current = activeMachine();
      if (current.id === id && id !== LOCAL_MACHINE_ID) {
        try {
          storage()?.setItem(MACHINE_STORAGE_KEY, JSON.stringify({ id, name: name.trim() }));
        } catch {}
      }
      notifyPeersChanged();
      await reload();
      return { ok: true };
    },
    [reload],
  );

  const removePeer = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch(`/api/peers?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return { ok: false, error: body.error || "Could not remove machine." };
      notifyPeersChanged();
      await reload();
      return { ok: true };
    },
    [reload],
  );

  const rotateToken = useCallback(async (): Promise<string | null> => {
    const res = await fetch("/api/peers/token", {
      method: "POST",
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { pairingCode?: string } | null;
    notifyPeersChanged();
    await reload();
    return body?.pairingCode ?? null;
  }, [reload]);

  const setInbound = useCallback(
    async (enabled: boolean): Promise<boolean> => {
      const res = await fetch("/api/peers/inbound", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }).catch(() => null);
      if (!res?.ok) return false;
      notifyPeersChanged();
      await reload();
      return true;
    },
    [reload],
  );

  return {
    ...snapshot,
    active: activeMachine(),
    setInbound,
    setUnified,
    addPeer,
    renamePeer,
    removePeer,
    rotateToken,
    reload,
  };
}
