import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { createBot, updateBot } from "./bots/store.ts";
import {
  conversationUnread,
  ensureBotConversationReadBaseline,
  markBotConversationRead,
} from "./bots/unread.ts";
import { assertBotConversationAccess, botViewer } from "./bots/access.ts";
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
  test("keeps one unread watermark when the primary runtime rotates", () => {
    const conversationId = "durable-conversation";
    ensureBotConversationReadBaseline("owner@example.com", conversationId, null, 1);
    indexSessionMessagesDirect("runtime-old", [assistant("old-reply")]);
    const oldCursor = latestIndexedAssistantCursor("runtime-old")!;
    markBotConversationRead("owner@example.com", conversationId, oldCursor.rowid, 2);

    indexSessionMessagesDirect("runtime-new", [assistant("new-reply")]);
    const newCursor = latestIndexedAssistantCursor("runtime-new")!;
    expect(newCursor.rowid).toBeGreaterThan(oldCursor.rowid);
    expect(conversationUnread("owner@example.com", conversationId, newCursor.rowid)).toBe(true);
    markBotConversationRead("owner@example.com", conversationId, newCursor.rowid, 3);
    expect(conversationUnread("owner@example.com", conversationId, newCursor.rowid)).toBe(false);
  });

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

  test("denies a different assigned user on a rostered self-hosted box", async () => {
    // The access decision moved to bots/access.ts so one module owns it for
    // both the self-hosted and the shared-Computer regime. This is the same
    // contract as before, now asserted against its owner.
    const bot = await createBot({ name: "Private", persona: "Private", owner: "owner@example.com" });
    await updateBot(bot.id, { sessionId: "private-conversation" });
    const sessions = [{ sessionId: "private-conversation", botId: bot.id, assignedUser: "owner@example.com" }];
    expect(() =>
      assertBotConversationAccess(
        botViewer(null, "other@example.com"),
        ["owner@example.com", "other@example.com"],
        "other@example.com",
        "private-conversation",
        sessions,
        [{ ...bot, sessionId: "private-conversation" }],
      ),
    ).toThrow("belongs to another user");
  });
});
