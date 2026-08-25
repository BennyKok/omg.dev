import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Bot } from "./bots/store.ts";
import { sanitizeBotClaudeAccountId } from "./bots/store.ts";
import { BOT_SELF_CREATE_FIELDS, BOT_SELF_UPDATE_FIELDS } from "./bots/self-management.ts";
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
    const cosmeticOnly: Bot = { ...before, colorway: "forest" };
    expect(sessionBoundConfigChanged(
      sessionBoundConfigOf(before),
      sessionBoundConfigOf(cosmeticOnly),
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

  test("a bot-created bot inherits the creating bot's pin", () => {
    expect(serve).toContain("const inheritedClaudeAccountId =");
    expect(serve).toContain("claudeAccountId: inheritedClaudeAccountId");
    // Dropped on a different backend and on an account that is gone, so
    // neither case refuses the new bot.
    expect(serve).toContain("resolveClaudeAccount(actor.bot.claudeAccountId)");
  });

  test("a bot cannot choose the account itself", () => {
    expect(BOT_SELF_CREATE_FIELDS.has("claudeAccountId")).toBe(false);
    expect(BOT_SELF_UPDATE_FIELDS.has("claudeAccountId")).toBe(false);
  });
});
