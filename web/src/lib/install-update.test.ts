import { expect, test } from "bun:test";
import { isInstallUpdateInfo } from "./install-update.ts";

const valid = {
  install: { channel: "source", updateCommand: "git pull --ff-only" },
  update: null,
  bootId: "boot-1",
};

test("accepts a real /api/install payload", () => {
  expect(isInstallUpdateInfo(valid)).toBe(true);
});

test("rejects the empty object the transport returns for HTML or a blank body", () => {
  expect(isInstallUpdateInfo({})).toBe(false);
  expect(isInstallUpdateInfo(null)).toBe(false);
  expect(isInstallUpdateInfo(undefined)).toBe(false);
});

test("rejects a payload whose install field cannot be read for .channel", () => {
  expect(isInstallUpdateInfo({ install: undefined, bootId: "x" })).toBe(false);
  expect(isInstallUpdateInfo({ install: null, bootId: "x" })).toBe(false);
  expect(isInstallUpdateInfo({ install: true, bootId: "x" })).toBe(false);
  expect(isInstallUpdateInfo({ install: "source", bootId: "x" })).toBe(false);
  expect(isInstallUpdateInfo({ install: {}, bootId: "x" })).toBe(false);
});
