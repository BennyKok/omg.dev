import { expect, test } from "bun:test";
import { sameEntries } from "./same-entries";

test("an identical rebuild keeps the previous record, so React can skip the render", () => {
  const list = [1];
  const prev = { a: list, b: list };
  expect(sameEntries(prev, { a: list, b: list })).toBe(prev);
});

test("a changed, added or removed entry is a new record", () => {
  const prev = { a: 1, b: 2 };
  expect(sameEntries(prev, { a: 1, b: 3 })).toEqual({ a: 1, b: 3 });
  expect(sameEntries(prev, { a: 1, b: 2, c: 3 })).not.toBe(prev);
  expect(sameEntries(prev, { a: 1 })).not.toBe(prev);
  expect(sameEntries(prev, { a: 1, c: 2 })).not.toBe(prev);
});
