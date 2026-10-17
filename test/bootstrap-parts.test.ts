import { expect, test } from "bun:test";
import { createBootstrapParts } from "../src/bootstrap-parts.ts";

// After a wake, one slow bootstrap part (the project list, 5.3 s) held the
// whole first screen. Failures this must catch: a slow part still holding the
// answer when an earlier value exists; a first load that answers without a
// value it never had; a failed part that stops the answer.
const later = <T,>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

test("a slow part answers with its last value and is named stale", async () => {
  const parts = createBootstrapParts(50);
  await parts.settle({ sessions: Promise.resolve(["s1"]), repos: Promise.resolve(["app"]) });
  const started = Date.now();
  const second = await parts.settle({ sessions: Promise.resolve(["s1", "s2"]), repos: later(1000, ["app", "new"]) });
  expect(Date.now() - started).toBeLessThan(500);
  expect(second.values).toEqual({ sessions: ["s1", "s2"], repos: ["app"] });
  expect(second.stale).toEqual(["repos"]);
  // The slow part still finishes and becomes the next answer.
  await later(1100, null);
  expect((await parts.settle({ repos: later(1000, ["x"]) })).values.repos).toEqual(["app", "new"]);
});

test("a part with no earlier value is awaited, and a failed part answers null", async () => {
  const parts = createBootstrapParts(10);
  const first = await parts.settle({ repos: later(60, ["app"]), findings: Promise.reject(new Error("boom")) });
  expect(first.values).toEqual({ repos: ["app"], findings: null });
  expect(first.stale).toEqual([]);
});
