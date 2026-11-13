import { describe, expect, test } from "bun:test";
import {
  activeMachine,
  isLocalMachine,
  isUnifiedFleetEnabled,
  LOCAL_MACHINE_ID,
  MACHINE_STORAGE_KEY,
  machineBasePath,
  selectMachine,
  setUnifiedFleetEnabled,
} from "./machines";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("machines transport & unified fleet helpers", () => {
  test("defaults to the local machine with empty basePath", () => {
    const store = memoryStorage();
    expect(activeMachine(store)).toEqual({ id: LOCAL_MACHINE_ID, name: "This computer" });
    expect(isLocalMachine(activeMachine(store))).toBe(true);
    expect(machineBasePath(LOCAL_MACHINE_ID)).toBe("");
  });

  test("stores a selected remote peer machine and builds its proxy basePath", () => {
    const store = memoryStorage();
    let reloads = 0;
    selectMachine(
      { id: "peer-studio", name: "Mac Studio" },
      { store, reload: () => { reloads += 1; } },
    );
    expect(reloads).toBe(1);
    expect(activeMachine(store)).toEqual({ id: "peer-studio", name: "Mac Studio" });
    expect(isLocalMachine(activeMachine(store))).toBe(false);
    expect(machineBasePath("peer-studio")).toBe("/api/peers/machines/peer-studio");

    // Selecting the same machine without a target sessionId is a no-op.
    selectMachine(
      { id: "peer-studio", name: "Mac Studio" },
      { store, reload: () => { reloads += 1; } },
    );
    expect(reloads).toBe(1);

    // Switching back to local removes the storage key.
    selectMachine(
      { id: LOCAL_MACHINE_ID, name: "This computer" },
      { store, reload: () => { reloads += 1; } },
    );
    expect(reloads).toBe(2);
    expect(store.getItem(MACHINE_STORAGE_KEY)).toBeNull();
  });

  test("unified fleet mode is enabled by default and can be toggled", () => {
    const store = memoryStorage();
    expect(isUnifiedFleetEnabled(store)).toBe(true);
    setUnifiedFleetEnabled(false, store);
    expect(isUnifiedFleetEnabled(store)).toBe(false);
    setUnifiedFleetEnabled(true, store);
    expect(isUnifiedFleetEnabled(store)).toBe(true);
  });
});
