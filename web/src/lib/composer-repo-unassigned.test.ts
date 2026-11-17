import { expect, test } from "bun:test";
import { composerStartsUnassigned } from "./composer-repo";
import { NO_PROJECT_FILTER } from "./project-filter";

test("No project scope always starts with no folder", () => {
  expect(composerStartsUnassigned({ scopedProject: NO_PROJECT_FILTER, pickedFolder: false })).toBe(true);
  expect(composerStartsUnassigned({ scopedProject: NO_PROJECT_FILTER, pickedFolder: true })).toBe(true);
});

test("All projects starts with no folder until one is picked", () => {
  expect(composerStartsUnassigned({ scopedProject: "__all", pickedFolder: false })).toBe(true);
  expect(composerStartsUnassigned({ scopedProject: "__all", pickedFolder: true })).toBe(false);
});

test("a folder scope uses its folder", () => {
  expect(composerStartsUnassigned({ scopedProject: "lfg", pickedFolder: false })).toBe(false);
});

test("the phone screen starts in the last folder chosen", async () => {
  const { phoneStartsInLastFolder } = await import("./composer-repo");
  const repos = [{ cwd: "/r/lfg" }, { cwd: "/r/vibes" }];
  expect(phoneStartsInLastFolder({ lastWasNoFolder: false, lastCwd: "/r/vibes", repos })).toBe(true);
  // "No project" was the last choice.
  expect(phoneStartsInLastFolder({ lastWasNoFolder: true, lastCwd: "/r/vibes", repos })).toBe(false);
  // A removed folder, or none remembered, never falls through to the first.
  expect(phoneStartsInLastFolder({ lastWasNoFolder: false, lastCwd: "/r/gone", repos })).toBe(false);
  expect(phoneStartsInLastFolder({ lastWasNoFolder: false, lastCwd: "", repos })).toBe(false);
});
