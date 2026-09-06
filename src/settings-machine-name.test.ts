import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { getGlobalSettingsSync, setGlobalSettings, resetSettingsDbConnectionForTests } from "./settings.ts";

const originalData = PATHS.data;
const dir = mkdtempSync(join(tmpdir(), "omg-machine-name-"));
beforeAll(() => { resetSettingsDbConnectionForTests(); PATHS.data = dir; });
afterAll(() => { resetSettingsDbConnectionForTests(); PATHS.data = originalData; rmSync(dir, { recursive: true, force: true }); });
test("local machine name survives reopening the settings database", async () => {
  expect(getGlobalSettingsSync().machineName).toBe("");
  await setGlobalSettings({ machineName: "  Studio Mac  " });
  resetSettingsDbConnectionForTests();
  expect(getGlobalSettingsSync().machineName).toBe("Studio Mac");
});
