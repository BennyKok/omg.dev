import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Bot } from "./bots/store.ts";
import { sanitizeBotClaudeAccountId } from "./bots/store.ts";
import {
  SESSION_BOUND_BOT_FIELDS,
  sessionBoundConfigChanged,
  sessionBoundConfigOf,
} from "./bots/rotation.ts";

const bot = (patch: Partial<Bot> = {}): Bot => ({
  id: "bot_one",
  name: "Scout",
  persona: "Be concise",
  agent: "aisdk",
  enabled: true,
  createdAt: 1,
  ...patch,
});

describe("bot Claude account pin", () => {
  test("keeps a pin on the Claude backend only", () => {
    expect(sanitizeBotClaudeAccountId("acct-2", "aisdk")).toBe("acct-2");
    expect(sanitizeBotClaudeAccountId("  acct-2  ", "aisdk")).toBe("acct-2");
    for (const agent of ["grok", "codex-aisdk", "opencode", "pi"]) {
      expect(sanitizeBotClaudeAccountId("acct-2", agent)).toBeUndefined();
    }
  });

  test("an empty value clears the pin, which is the Auto selection", () => {
    expect(sanitizeBotClaudeAccountId("", "aisdk")).toBeUndefined();
    expect(sanitizeBotClaudeAccountId(null, "aisdk")).toBeUndefined();
    expect(sanitizeBotClaudeAccountId(undefined, "aisdk")).toBeUndefined();
  });

  test("changing the pin is session bound, so it offers a rotation", () => {
    expect(SESSION_BOUND_BOT_FIELDS.has("claudeAccountId")).toBe(true);
    const before = bot({ claudeAccountId: "acct-1" });
    expect(sessionBoundConfigChanged(
      sessionBoundConfigOf(before),
      sessionBoundConfigOf({ ...before, claudeAccountId: "acct-2" }),
    )).toBe(true);
    expect(sessionBoundConfigChanged(
      sessionBoundConfigOf(before),
      sessionBoundConfigOf({ ...before, colorway: "forest" }),
    )).toBe(false);
  });
});

describe("bot launch honours the pin", () => {
  const serve = readFileSync(join(import.meta.dir, "commands", "serve.ts"), "utf8");

  test("the bot routes validate the pin", () => {
    expect(serve).toContain("validateBotAgent(agentValue, model, thinkingLevel, claudeAccountId)");
    expect(serve).toContain("validateBotAgent(bot.agent, bot.model, bot.thinkingLevel, bot.claudeAccountId)");
    expect(serve).toContain('return { error: "Claude account is missing or not connected" }');
  });

  test("launch passes the pin to the account picker", () => {
    expect(serve).toContain("explicitAccountId: bot.claudeAccountId");
  });
});
