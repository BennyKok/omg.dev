/**
 * Which machine this UI is pointed at.
 *
 * The box that served this page is the default. Any other machine on the
 * signed-in omg Cloud account is reached through that box's own proxy at
 * CLOUD_MACHINES_PREFIX plus the binding id, so switching is one transport swap: every
 * API path gets that prefix and nothing else in the app changes.
 *
 * The choice is applied at boot, before the app mounts, and a switch reloads
 * the page. That is deliberate. The app tree holds a great deal of state
 * captured from the previous machine (sessions, roster, filters, sockets), and
 * swapping the transport underneath a mounted tree shows the old box's answers
 * under the new box's name until every reader learns to discard them. A reload
 * costs one paint and is correct by construction.
 */

import { createSameOriginTransport, type OmgTransport } from "@omg-dev/client";

export const MACHINE_STORAGE_KEY = "omg:machine";

/** The box that served the page. Never a cloud binding id. */
export const LOCAL_MACHINE_ID = "local";

export const CLOUD_MACHINES_PREFIX = "/api/cloud/machines/";

export type MachineChoice = {
  id: string;
  /** Shown in the rail and the picker. */
  name: string;
};

function storage(): Storage | null {
  try {
    // The window's storage first: in a browser the two are the same object,
    // and under the test DOM only the window carries the real one.
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
    return { id: parsed.id, name: typeof parsed.name === "string" && parsed.name ? parsed.name : parsed.id };
  } catch {
    return { id: LOCAL_MACHINE_ID, name: "This computer" };
  }
}

export function isLocalMachine(choice: MachineChoice = activeMachine()): boolean {
  return choice.id === LOCAL_MACHINE_ID;
}

/** The API prefix for a machine, or "" for the local box. */
export function machineBasePath(id: string): string {
  return id === LOCAL_MACHINE_ID ? "" : `${CLOUD_MACHINES_PREFIX}${encodeURIComponent(id)}`;
}

/** The transport the app should boot with for the stored choice. */
export function machineTransport(choice: MachineChoice = activeMachine()): OmgTransport {
  return createSameOriginTransport({ basePath: machineBasePath(choice.id) });
}

/**
 * Persist a choice and reload, so the app boots against the new machine.
 * Choosing the current machine is a no-op.
 */
export function selectMachine(
  choice: MachineChoice,
  {
    store = storage(),
    reload = () => window.location.reload(),
  }: { store?: Storage | null; reload?: () => void } = {},
): void {
  const current = activeMachine(store);
  if (current.id === choice.id) return;
  try {
    if (choice.id === LOCAL_MACHINE_ID) store?.removeItem(MACHINE_STORAGE_KEY);
    else store?.setItem(MACHINE_STORAGE_KEY, JSON.stringify({ id: choice.id, name: choice.name }));
  } catch {
    // Private mode: the choice lasts until the reload only.
  }
  reload();
}
