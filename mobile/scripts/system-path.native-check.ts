/**
 * `omg:///` is "open the app", not a destination. Routing it to the root that
 * the app already opens at is what stacked a ghost home screen behind the real
 * one.
 */
import { expect, test } from "bun:test";
import { systemPathTarget } from "../src/omg/system-path";

test("a destination-less widget or activity tap is dropped, not routed", () => {
  for (const url of ["omg:///", "omg://", "omg:///?x=1", "omg:///#top"]) {
    expect(systemPathTarget(url)).toBeNull();
  }
});

test("a real destination is passed through untouched", () => {
  for (const url of [
    "omg:///session/abc",
    "omg:///notifications",
    "omg:///session/abc?from=widget",
  ]) {
    expect(systemPathTarget(url)).toBe(url);
  }
});

test("the dev client's own launch URL still works", () => {
  // Breaking this makes the simulator unusable, and the failure looks like a
  // Metro problem rather than a routing one.
  const url = "omg://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8099";
  expect(systemPathTarget(url)).toBe(url);
});

test("nothing at all is dropped rather than thrown", () => {
  expect(systemPathTarget("")).toBeNull();
  expect(systemPathTarget(undefined as unknown as string)).toBeNull();
});
