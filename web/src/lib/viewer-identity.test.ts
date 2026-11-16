import { expect, test } from "bun:test";
import { adoptServerIdentity, OWNER_VIEWER } from "./viewer-role";

function storageWith(initial: string | null) {
  const store = new Map<string, string>(initial === null ? [] : [["lfg_user", initial]]);
  return { store, getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
}

test("the server's identity replaces the browser's pick, once", () => {
  const storage = storageWith("angel@example.com");
  const viewer = { ...OWNER_VIEWER, identityLogin: "benny@example.com" };
  expect(adoptServerIdentity(viewer, storage)).toBe(true);
  expect(storage.store.get("lfg_user")).toBe("benny@example.com");
  // Already that person: nothing to change, so no second reload.
  expect(adoptServerIdentity(viewer, storage)).toBe(false);
});

test("with no server identity the browser's pick stays", () => {
  const storage = storageWith("angel@example.com");
  expect(adoptServerIdentity(OWNER_VIEWER, storage)).toBe(false);
  expect(adoptServerIdentity(null, storage)).toBe(false);
  expect(storage.store.get("lfg_user")).toBe("angel@example.com");
});
