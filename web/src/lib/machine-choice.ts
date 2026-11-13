// Which machine the app is pointed at. No DOM types and no React: the
// transport layer (omg-client.ts via session-routing.ts) imports this, and the
// root type check compiles that without a DOM library. lib/machines.ts
// re-exports everything here.

/**
 * The linked machine the UI is pointed at. Not "omg:machine": that key held
 * choices from the removed omg Cloud switcher, and main.tsx clears it.
 */
export const MACHINE_STORAGE_KEY = "omg:peer-machine";

/** The box that served the page. */
export const LOCAL_MACHINE_ID = "local";

export const PEER_MACHINES_PREFIX = "/api/peers/machines/";

export type MachineChoice = {
  id: string;
  /** Shown in the rail and the picker. */
  name: string;
};

/** The part of `Storage` read here, typed without the DOM library. */
type ChoiceStore = { getItem(key: string): string | null };

function storage(): ChoiceStore | null {
  try {
    const g = globalThis as { localStorage?: ChoiceStore; window?: { localStorage?: ChoiceStore } };
    return g.window?.localStorage ?? g.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The stored choice, or the local box. */
export function activeMachine(store: ChoiceStore | null = storage()): MachineChoice {
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
