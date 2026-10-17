import { expect, test } from "bun:test";
import { keepIfSame } from "../src/omg/keep-if-same";

test("an answer with the same rows keeps the previous array, so React skips the render", () => {
  const prev = [{ id: "a", text: "one", status: "held" }];
  const next = [{ id: "a", text: "one", status: "held" }];
  expect(keepIfSame(prev, next)).toBe(prev);
  expect(keepIfSame([], [])).toEqual([]);
  const empty: unknown[] = [];
  expect(keepIfSame(empty, [])).toBe(empty);
});

test("any change in the rows is a new array", () => {
  const prev = [{ id: "a", text: "one", status: "held" }];
  expect(keepIfSame(prev, [{ id: "a", text: "two", status: "held" }])).not.toBe(prev);
  expect(keepIfSame(prev, [])).toEqual([]);
  expect(keepIfSame(prev, [...prev, { id: "b", text: "x", status: "held" }])).toHaveLength(2);
});
