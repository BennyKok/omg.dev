import { describe, expect, test } from "bun:test";
import {
  TIBO_MODE_STORAGE_KEY,
  canUseTiboMode,
  readTiboMode,
  resolveTiboLaunch,
  writeTiboMode,
} from "./tibo-mode";

describe("Tibo mode", () => {
  test("is available only for supported Codex models with High thinking", () => {
    expect(canUseTiboMode({
      agent: "codex-aisdk",
      model: "gpt-5.6-sol",
      thinkingLevels: ["low", "medium", "high"],
    })).toBe(true);
    expect(canUseTiboMode({
      agent: "codex-aisdk",
      model: "gpt-5.3-codex-spark",
      thinkingLevels: ["low", "medium", "high"],
    })).toBe(false);
    expect(canUseTiboMode({
      agent: "aisdk",
      model: "gpt-5.6-sol",
      thinkingLevels: ["high"],
    })).toBe(false);
  });

  test("keeps the selected model while applying Fast and High", () => {
    expect(resolveTiboLaunch({
      enabled: true,
      available: true,
      model: "gpt-5.6-luna",
      thinkingLevel: "minimal",
    })).toEqual({
      model: "gpt-5.6-luna",
      thinkingLevel: "high",
      fastMode: true,
    });
  });

  test("does not alter ordinary or unavailable launches", () => {
    expect(resolveTiboLaunch({
      enabled: false,
      available: true,
      model: "gpt-5.6-sol",
      thinkingLevel: "low",
    })).toEqual({ model: "gpt-5.6-sol", thinkingLevel: "low" });
    expect(resolveTiboLaunch({
      enabled: true,
      available: false,
      model: "gpt-5.3-codex-spark",
      thinkingLevel: "low",
    })).toEqual({ model: "gpt-5.3-codex-spark", thinkingLevel: "low" });
  });

  test("persists the user's preference", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    writeTiboMode(storage, true);
    expect(values.get(TIBO_MODE_STORAGE_KEY)).toBe("on");
    expect(readTiboMode(storage)).toBe(true);
    writeTiboMode(storage, false);
    expect(readTiboMode(storage)).toBe(false);
  });
});
