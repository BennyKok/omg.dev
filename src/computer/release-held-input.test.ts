import { expect, test } from "bun:test";
import { desktopConfig, releaseHeldInput } from "./desktop.ts";

test("releaseHeldInput does nothing when the desktop is down", async () => {
  expect(desktopConfig()).toBeNull();
  expect(await releaseHeldInput()).toBe(false);
});
