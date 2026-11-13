import { createSameOriginTransport, type OmgTransport } from "@omg-dev/client";
import { activeMachine, LOCAL_MACHINE_ID, machineBasePath } from "./machine-choice";

// Which machine owns a session, and the transport that reaches it.
//
// The app boots on one machine (the local box, or the one picked in the
// switcher) and its module transport (omg-client.ts) goes there. The unified
// sidebar also lists sessions that live on OTHER linked machines. Opening one
// of those must not move the whole app: only that session's requests and its
// live transcript go to its own machine, through this box's peer proxy
// (/api/peers/machines/<id>/...). This module is the one place that decides.
//
// App feeds the owner map from the fleet poll (usePeerMachines in
// lib/machines.ts). A session not in the map belongs to the machine the app
// booted on.

export const SESSION_OWNERS_STORAGE_KEY = "omg:session-owners";

const owners = new Map<string, string>();
const transports = new Map<string, OmgTransport>();
const listeners = new Set<() => void>();

// Kept per tab, so a reload or a deep link to a linked machine's session
// routes it before the first fleet poll answers.
/** The part of `Storage` used here, typed without the DOM library. */
type TabStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function sessionStore(): TabStore | null {
  try {
    const g = globalThis as { sessionStorage?: TabStore; window?: { sessionStorage?: TabStore } };
    return g.window?.sessionStorage ?? g.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function loadOwners(): void {
  try {
    const raw = sessionStore()?.getItem(SESSION_OWNERS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return;
    for (const [sid, id] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof id === "string" && id) owners.set(sid, id);
    }
  } catch {
    // A corrupt entry routes nothing; the next poll replaces it.
  }
}

function saveOwners(): void {
  try {
    sessionStore()?.setItem(SESSION_OWNERS_STORAGE_KEY, JSON.stringify(Object.fromEntries(owners)));
  } catch {
    // Private mode: the map lasts until the reload only.
  }
}

loadOwners();

/**
 * Replace the owner map. `entries` holds every session the fleet poll saw on a
 * machine other than the app's own, with that machine's id ("local" for this
 * box while the app is switched onto a peer).
 */
export function setSessionOwners(entries: Iterable<{ sessionId: string; machineId: string }>): void {
  const next = new Map<string, string>();
  for (const { sessionId, machineId } of entries) {
    if (sessionId && machineId) next.set(sessionId, machineId);
  }
  let changed = next.size !== owners.size;
  if (!changed) {
    for (const [sid, id] of next) {
      if (owners.get(sid) !== id) {
        changed = true;
        break;
      }
    }
  }
  if (!changed) return;
  owners.clear();
  for (const [sid, id] of next) owners.set(sid, id);
  saveOwners();
  for (const listener of listeners) listener();
}

export function subscribeSessionOwners(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The machine a session lives on, when that is NOT the machine the app booted
 * on. Null means "use the app's own transport".
 */
export function remoteMachineForSession(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  const owner = owners.get(sessionId);
  if (!owner || owner === activeMachine().id) return null;
  return owner;
}

/** A same-origin transport for one machine, cached so sockets and reads share it. */
export function transportForMachine(machineId: string): OmgTransport {
  let transport = transports.get(machineId);
  if (!transport) {
    transport = createSameOriginTransport({
      basePath: machineId === LOCAL_MACHINE_ID ? "" : machineBasePath(machineId),
    });
    transports.set(machineId, transport);
  }
  return transport;
}

const SESSION_PATH = /^\/api\/sessions\/([^/?#]+)(?:[/?#]|$)/;

/** The session an API path is about: `/api/sessions/<sid>/...` or `?sessionId=<sid>`. */
export function sessionIdForPath(path: string): string | null {
  const match = SESSION_PATH.exec(path);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  const query = path.indexOf("?");
  if (query === -1) return null;
  const sid = new URLSearchParams(path.slice(query + 1)).get("sessionId");
  return sid || null;
}

/** The transport for an API path when it belongs to another machine, else null. */
export function routedTransportForPath(path: string): OmgTransport | null {
  const machineId = remoteMachineForSession(sessionIdForPath(path));
  return machineId ? transportForMachine(machineId) : null;
}

/** Test seam: forget every owner and cached transport. */
export function resetSessionRoutingForTest(): void {
  try {
    sessionStore()?.removeItem(SESSION_OWNERS_STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
  owners.clear();
  transports.clear();
  listeners.clear();
}
