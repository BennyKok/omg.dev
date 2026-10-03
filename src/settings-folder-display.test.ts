import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import * as settings from "./settings.ts";

const originalData = PATHS.data;
let testData = "";

beforeAll(async () => {
  const base = join(homedir(), ".cache", "lfg", "tmp");
  await mkdir(base, { recursive: true });
  testData = await mkdtemp(join(base, "lfg-folder-display-"));
  PATHS.data = testData;
  settings.resetSettingsDbConnectionForTests();
});

afterAll(async () => {
  settings.resetSettingsDbConnectionForTests();
  PATHS.data = originalData;
  await rm(testData, { recursive: true, force: true });
});

describe("folder display settings", () => {
  test("default to the machine's order, nothing hidden, paths off", () => {
    const current = settings.getGlobalSettingsSync();
    expect(current.folderOrder).toEqual([]);
    expect(current.hiddenFolders).toEqual([]);
    expect(current.showProjectPaths).toBe(false);
  });

  test("persist across a reopen, so every client reads the same arrangement", async () => {
    await settings.setGlobalSettings({
      folderOrder: ["beta", "alpha"],
      hiddenFolders: ["gamma"],
      showProjectPaths: true,
    });
    settings.resetSettingsDbConnectionForTests();
    const current = settings.getGlobalSettingsSync();
    expect(current.folderOrder).toEqual(["beta", "alpha"]);
    expect(current.hiddenFolders).toEqual(["gamma"]);
    expect(current.showProjectPaths).toBe(true);
  });

  test("sanitizeFolderKeys drops junk and duplicates, and rejects non-arrays", () => {
    expect(settings.sanitizeFolderKeys(["a", "a", "", 3, "b"])).toEqual(["a", "b"]);
    expect(settings.sanitizeFolderKeys("a")).toBeNull();
    expect(settings.sanitizeFolderKeys(null)).toBeNull();
  });
});
