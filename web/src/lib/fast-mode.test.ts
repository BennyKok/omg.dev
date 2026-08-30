import { describe, expect, test } from "bun:test";
import {
  composerSupportsFastMode,
  fastModeStorageKey,
  parseFastChatCommand,
  readFastMode,
  writeFastMode,
} from "./fast-mode";

describe("normal Fast mode", () => {
  test("supports eligible Codex models and Claude", () => {
    expect(composerSupportsFastMode({ agent: "codex-aisdk", model: "gpt-5.6-luna" })).toBe(true);
    expect(composerSupportsFastMode({ agent: "codex-aisdk", model: "gpt-5.3-codex-spark" })).toBe(false);
    expect(composerSupportsFastMode({ agent: "aisdk", model: "opus" })).toBe(true);
    expect(composerSupportsFastMode({ agent: "opencode", model: "glm" })).toBe(false);
  });

  test("stores Codex and Claude preferences independently", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    writeFastMode(storage, "codex-aisdk", true);
    writeFastMode(storage, "aisdk", false);
    expect(readFastMode(storage, "codex",)).toBe(true);
    expect(readFastMode(storage, "claude")).toBe(false);
    expect(fastModeStorageKey("codex-aisdk")).not.toBe(fastModeStorageKey("aisdk"));
  });

  test("parses the chat control without swallowing ordinary prompts", () => {
    expect(parseFastChatCommand("/fast")).toEqual({ matched: true });
    expect(parseFastChatCommand(" /FAST on ")).toEqual({ matched: true, enabled: true });
    expect(parseFastChatCommand("/fast off")).toEqual({ matched: true, enabled: false });
    expect(parseFastChatCommand("explain /fast mode")).toEqual({ matched: false });
    expect(parseFastChatCommand("/faster")).toEqual({ matched: false });
    expect(parseFastChatCommand("/fast maybe")).toEqual({
      matched: true,
      error: 'Use "/fast", "/fast on", or "/fast off".',
    });
  });
});
