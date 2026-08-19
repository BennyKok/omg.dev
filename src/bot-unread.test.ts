import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { createBot, updateBot } from "./bots/store.ts";
import {
  assertConversationAccess,
  conversationUnread,
  ensureBotConversationReadBaseline,
  markBotConversationRead,
} from "./bots/unread.ts";
import { indexSessionMessagesDirect, latestIndexedAssistantCursor } from "./transcript-index.ts";

const originalData = PATHS.data;
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omg-bot-unread-"));
  PATHS.data = root;
});

afterEach(() => {
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

const assistant = (id: string, text = id) => ({ id, role: "assistant" as const, kind: "text" as const, text, ts: Date.now() });
const user = (id: string, text = id) => ({ id, role: "user" as const, kind: "text" as const, text, ts: Date.now() });

describe("persistent bot conversation unread watermarks", () => {
  test("creates unread only for new assistant output and clears it when viewed", async () => {
    const bot = await createBot({ name: "Scout", persona: "Scout", owner: "owner@example.com" });
    await updateBot(bot.id, { sessionId: "conversation-a" });
    ensureBotConversationReadBaseline("owner@example.com", "conversation-a", null, 1);

    indexSessionMessagesDirect("conversation-a", [user("mine")]);
    expect(conversationUnread("owner@example.com", "conversation-a", latestIndexedAssistantCursor("conversation-a")?.rowid ?? null)).toBe(false);

    indexSessionMessagesDirect("conversation-a", [assistant("reply")]);
    const cursor = latestIndexedAssistantCursor("conversation-a")!;
    expect(conversationUnread("owner@example.com", "conversation-a", cursor.rowid)).toBe(true);

    markBotConversationRead("owner@example.com", "conversation-a", cursor.rowid, 2);
    expect(conversationUnread("owner@example.com", "conversation-a", cursor.rowid)).toBe(false);
  });

  test("isolates conversations for one bot and survives a store reload", () => {
    ensureBotConversationReadBaseline("owner@example.com", "one", null);
    ensureBotConversationReadBaseline("owner@example.com", "two", null);
    indexSessionMessagesDirect("one", [assistant("one-reply")]);
    indexSessionMessagesDirect("two", [user("peer-arrival", "[Peer message from Planner (bot_a) to Builder (bot_b)]\n\nbot-to-bot arrival")]);
    const one = latestIndexedAssistantCursor("one")!;
    const two = latestIndexedAssistantCursor("two")!;
    markBotConversationRead("owner@example.com", "one", one.rowid);
    expect(conversationUnread("owner@example.com", "one", one.rowid)).toBe(false);
    expect(conversationUnread("owner@example.com", "two", two.rowid)).toBe(true);
    // Every call reloads the durable file. This models process/reconnect hydration.
    expect(conversationUnread("owner@example.com", "two", two.rowid)).toBe(true);
  });

  test("denies a different assigned user", async () => {
    const bot = await createBot({ name: "Private", persona: "Private", owner: "owner@example.com" });
    await updateBot(bot.id, { sessionId: "private-conversation" });
    const sessions = [{ sessionId: "private-conversation", botId: bot.id, assignedUser: "owner@example.com" }];
    expect(() => assertConversationAccess("other@example.com", "private-conversation", sessions, [{ ...bot, sessionId: "private-conversation" }]))
      .toThrow("belongs to another user");
  });
});
