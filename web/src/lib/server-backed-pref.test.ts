import { beforeEach, expect, test } from "bun:test";
import { mount } from "../test-support/render";
const { createServerBackedPref } = await import("./server-backed-pref");

mount().cleanup();

let n = 0;
let key = "";
beforeEach(() => {
  key = `test_pref_${++n}`;
});

const make = () =>
  createServerBackedPref<string[]>({
    storageKey: key,
    defaults: [],
    parse: (raw) => (Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : []),
  });

test("adopts the box value and sends writes to the box, not to localStorage", async () => {
  const store = make();
  const sent: string[][] = [];
  store.connect(["b", "a"], false, async (value) => {
    sent.push(value);
  });
  expect(store.get()).toEqual(["b", "a"]);
  store.set(["a", "b"]);
  expect(store.get()).toEqual(["a", "b"]);
  expect(sent).toEqual([["a", "b"]]);
  expect(window.localStorage.getItem(key)).toBeNull();
});

test("moves an old browser value up once when the box has none, then removes it", async () => {
  window.localStorage.setItem(key, JSON.stringify(["x", "y"]));
  const store = make();
  const sent: string[][] = [];
  store.connect([], true, async (value) => {
    sent.push(value);
  });
  expect(store.get()).toEqual(["x", "y"]);
  await Promise.resolve();
  await Promise.resolve();
  expect(sent).toEqual([["x", "y"]]);
  expect(window.localStorage.getItem(key)).toBeNull();
});

test("the box value wins over an old browser value", () => {
  window.localStorage.setItem(key, JSON.stringify(["local"]));
  const store = make();
  store.connect(["box"], false, async () => {});
  expect(store.get()).toEqual(["box"]);
  expect(window.localStorage.getItem(key)).toBeNull();
});

test("an answer that lands while a write is in flight does not undo the write", async () => {
  const store = make();
  let release = () => {};
  store.connect([], false, () => new Promise<void>((resolve) => (release = resolve)));
  store.set(["new"]);
  store.connect(["stale"], false, async () => {});
  expect(store.get()).toEqual(["new"]);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  store.connect(["new"], false, async () => {});
  expect(store.get()).toEqual(["new"]);
});

test("an older box keeps the browser-local value", () => {
  window.localStorage.setItem(key, JSON.stringify(["local"]));
  const store = make();
  store.disconnect();
  expect(store.get()).toEqual(["local"]);
  store.set(["changed"]);
  expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(["changed"]);
});
