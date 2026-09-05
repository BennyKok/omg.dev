import { expect, test } from "bun:test";

import {
  LOCAL_MACHINE_ID,
  MACHINE_STORAGE_KEY,
  activeMachine,
  machineBasePath,
  machineTransport,
  selectMachine,
} from "./machines";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

test("the local box is the default and survives garbage in storage", () => {
  const store = new MemoryStorage();
  expect(activeMachine(store)).toEqual({ id: LOCAL_MACHINE_ID, name: "This computer" });
  store.setItem(MACHINE_STORAGE_KEY, "{not json");
  expect(activeMachine(store).id).toBe(LOCAL_MACHINE_ID);
  store.setItem(MACHINE_STORAGE_KEY, JSON.stringify({ id: "local" }));
  expect(activeMachine(store).id).toBe(LOCAL_MACHINE_ID);
});

test("selecting a machine persists it and reloads; selecting the same one does nothing", () => {
  const store = new MemoryStorage();
  let reloads = 0;
  const reload = () => {
    reloads += 1;
  };
  selectMachine({ id: "cloud", name: "Cloud computer" }, { store, reload });
  expect(activeMachine(store)).toEqual({ id: "cloud", name: "Cloud computer" });
  expect(reloads).toBe(1);

  selectMachine({ id: "cloud", name: "Cloud computer" }, { store, reload });
  expect(reloads).toBe(1);

  selectMachine({ id: LOCAL_MACHINE_ID, name: "This computer" }, { store, reload });
  expect(store.getItem(MACHINE_STORAGE_KEY)).toBeNull();
  expect(reloads).toBe(2);
});

test("a cloud machine's transport prefixes every path with the box proxy", async () => {
  expect(machineBasePath(LOCAL_MACHINE_ID)).toBe("");
  expect(machineBasePath("62494ca7-db41")).toBe("/api/cloud/machines/62494ca7-db41");

  const transport = machineTransport({ id: "cloud", name: "Cloud computer" });
  expect(transport.assetUrl?.("/api/sessions/s1/files/a.png")).toBe(
    "/api/cloud/machines/cloud/api/sessions/s1/files/a.png",
  );
  const local = machineTransport({ id: LOCAL_MACHINE_ID, name: "This computer" });
  expect(local.assetUrl?.("/api/sessions/s1/files/a.png")).toBe("/api/sessions/s1/files/a.png");
});
