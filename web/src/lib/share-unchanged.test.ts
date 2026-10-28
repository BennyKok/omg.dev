import { expect, test } from "bun:test";
import { shareUnchanged } from "./share-unchanged";

const key = (item: { id: string }) => item.id;

test("an unchanged list returns the previous array", () => {
  const prev = [{ id: "a", n: 1 }, { id: "b", n: 2 }];
  expect(shareUnchanged(prev, [{ id: "a", n: 1 }, { id: "b", n: 2 }], key)).toBe(prev);
});

test("only the changed item is a new object", () => {
  const prev = [{ id: "a", n: 1 }, { id: "b", n: 2 }];
  const next = shareUnchanged(prev, [{ id: "a", n: 1 }, { id: "b", n: 3 }], key);
  expect(next).not.toBe(prev);
  expect(next[0]).toBe(prev[0]);
  expect(next[1]).toEqual({ id: "b", n: 3 });
});

test("a reorder keeps the items but returns a new array", () => {
  const prev = [{ id: "a", n: 1 }, { id: "b", n: 2 }];
  const next = shareUnchanged(prev, [{ id: "b", n: 2 }, { id: "a", n: 1 }], key);
  expect(next).not.toBe(prev);
  expect(next[0]).toBe(prev[1]);
  expect(next[1]).toBe(prev[0]);
});

test("added and removed items", () => {
  const prev = [{ id: "a", n: 1 }, { id: "b", n: 2 }];
  const next = shareUnchanged(prev, [{ id: "a", n: 1 }, { id: "c", n: 3 }], key);
  expect(next[0]).toBe(prev[0]);
  expect(next).toHaveLength(2);
  expect(shareUnchanged(prev, [{ id: "a", n: 1 }], key)).toEqual([prev[0]]);
});
