import { describe, expect, test } from "bun:test";
import { runUpdateCheck, startAutoUpdate, type UpdaterPort } from "./auto-update";

type Fake = UpdaterPort & { calls: string[] };

function fakeUpdater(options: {
  channel?: string;
  baseUrl?: string;
  available?: boolean;
  checkError?: string;
  ready?: boolean;
  downloadError?: string;
  throwOnCheck?: boolean;
} = {}): Fake {
  const calls: string[] = [];
  return {
    calls,
    localInfo: {
      channel: async () => options.channel ?? "stable",
      baseUrl: async () => options.baseUrl ?? "https://example.test/releases",
    },
    checkForUpdate: async () => {
      calls.push("check");
      if (options.throwOnCheck) throw new Error("offline");
      return {
        updateAvailable: options.available ?? true,
        error: options.checkError ?? "",
        version: "1.2.3",
      };
    },
    downloadUpdate: async () => {
      calls.push("download");
    },
    updateInfo: () => ({
      updateReady: options.ready ?? true,
      error: options.downloadError ?? "",
      version: "1.2.3",
    }),
    applyUpdate: async () => {
      calls.push("apply");
    },
  };
}

const quiet = () => {};

describe("runUpdateCheck", () => {
  test("downloads, asks, and applies an available update", async () => {
    const updater = fakeUpdater();
    const asked: string[] = [];
    const result = await runUpdateCheck(updater, async (version) => {
      asked.push(version);
      return true;
    }, quiet);
    expect(result).toBe("applied");
    expect(asked).toEqual(["1.2.3"]);
    expect(updater.calls).toEqual(["check", "download", "apply"]);
  });

  test("does not apply when the user declines", async () => {
    const updater = fakeUpdater();
    expect(await runUpdateCheck(updater, async () => false, quiet)).toBe("declined");
    expect(updater.calls).toEqual(["check", "download"]);
  });

  test("is disabled for dev builds and builds without a release URL", async () => {
    for (const updater of [fakeUpdater({ channel: "dev" }), fakeUpdater({ baseUrl: "" })]) {
      expect(await runUpdateCheck(updater, async () => true, quiet)).toBe("disabled");
      expect(updater.calls).toEqual([]);
    }
  });

  test("stops when no update is available", async () => {
    const updater = fakeUpdater({ available: false });
    expect(await runUpdateCheck(updater, async () => true, quiet)).toBe("up-to-date");
    expect(updater.calls).toEqual(["check"]);
  });

  test("never prompts after a failed check or download", async () => {
    let prompted = false;
    const prompt = async () => (prompted = true);
    expect(await runUpdateCheck(fakeUpdater({ checkError: "HTTP 404" }), prompt, quiet)).toBe("error");
    expect(await runUpdateCheck(fakeUpdater({ ready: false }), prompt, quiet)).toBe("error");
    expect(await runUpdateCheck(fakeUpdater({ downloadError: "bad hash" }), prompt, quiet)).toBe("error");
    expect(await runUpdateCheck(fakeUpdater({ throwOnCheck: true }), prompt, quiet)).toBe("error");
    expect(prompted).toBe(false);
  });
});

describe("startAutoUpdate", () => {
  test("checks after the initial delay and stops once applied", async () => {
    const updater = fakeUpdater();
    const stop = startAutoUpdate(updater, async () => true, { initialDelayMs: 1, intervalMs: 5 });
    await Bun.sleep(40);
    stop();
    expect(updater.calls).toEqual(["check", "download", "apply"]);
  });

  test("offers a declined update again on the next tick", async () => {
    const updater = fakeUpdater();
    let prompts = 0;
    const stop = startAutoUpdate(updater, async () => {
      prompts += 1;
      return false;
    }, { initialDelayMs: 1, intervalMs: 5 });
    await Bun.sleep(40);
    stop();
    expect(prompts).toBeGreaterThan(1);
  });
});
