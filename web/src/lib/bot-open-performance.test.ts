import { describe, expect, test } from "bun:test";
import {
  botConversationRows,
  botConversationSubscriptionIds,
  clearBotConversationUnread,
  type BotConversationUnread,
} from "./bot-unread";

// Opening a bot has to be as cheap as opening a regular chat. These lock the
// properties that made it expensive in v0.2.9.

describe("opening a bot conversation", () => {
  test("clears the opened dot locally, so the row never waits on the read POST", () => {
    const before: BotConversationUnread[] = [
      { sessionId: "a1", botId: "a", unread: true },
      { sessionId: "b1", botId: "b", unread: true },
    ];
    const after = clearBotConversationUnread(before, "a1");
    // Cleared without any server round trip having happened.
    expect(after.map((row) => [row.sessionId, row.unread])).toEqual([["a1", false], ["b1", true]]);
  });

  test("opening an already-read conversation does not churn roster identity", () => {
    const conversations: BotConversationUnread[] = [{ sessionId: "a1", botId: "a", unread: false }];
    // Same reference: effects that key on the roster must not re-run.
    expect(clearBotConversationUnread(conversations, "a1")).toBe(conversations);
    expect(clearBotConversationUnread(conversations, "missing")).toBe(conversations);
  });

  test("watches one transcript channel per bot, not one per delegated child", () => {
    // What the server now sends: one canonical conversation per bot.
    const conversations: BotConversationUnread[] = [
      { sessionId: "a1", botId: "a", unread: false },
      { sessionId: "b1", botId: "b", unread: false },
      { sessionId: "c1", botId: "c", unread: false },
    ];
    expect(botConversationSubscriptionIds(conversations)).toEqual(["a1", "b1", "c1"]);
  });

  test("keeps the subscription set stable when a refresh reorders the payload", () => {
    const one: BotConversationUnread[] = [
      { sessionId: "b1", botId: "b", unread: false },
      { sessionId: "a1", botId: "a", unread: true },
    ];
    // Same conversations, different order and different unread flags — the
    // subscribing effect must not see a changed set and re-open every channel.
    const two: BotConversationUnread[] = [
      { sessionId: "a1", botId: "a", unread: false },
      { sessionId: "b1", botId: "b", unread: false },
    ];
    expect(botConversationSubscriptionIds(one).join(",")).toBe(
      botConversationSubscriptionIds(two).join(","),
    );
  });

  test("a bot with a large delegated fleet still costs one row and one channel", () => {
    // Realistic heavy case: one long-lived bot that has spawned 200 children.
    const bot = { id: "busy", sessionId: "busy-main" };
    const sessions = [
      { sessionId: "busy-main", botId: "busy" },
      ...Array.from({ length: 200 }, (_, i) => ({
        sessionId: `child-${i}`,
        botId: "busy",
        parentSessionId: "busy-main",
        subagentDepth: 1 + (i % 3),
        spawnedBy: "subagent",
      })),
    ];
    const conversations: BotConversationUnread[] = [
      { sessionId: "busy-main", botId: "busy", unread: true },
    ];
    const rows = botConversationRows([bot], sessions, conversations);
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionId).toBe("busy-main");
    expect(botConversationSubscriptionIds(conversations)).toEqual(["busy-main"]);
  });

  test("resolving the row does not depend on the child sessions being present", () => {
    // The roster must not need a full session-list scan to know which
    // conversation to open: the configured primary alone is enough.
    const bot = { id: "a", sessionId: "a1" };
    const conversations: BotConversationUnread[] = [{ sessionId: "a1", botId: "a", unread: false }];
    const withNoSessions = botConversationRows([bot], [], conversations);
    const withManySessions = botConversationRows(
      [bot],
      [
        { sessionId: "a1", botId: "a" },
        { sessionId: "x", botId: "a", parentSessionId: "a1", subagentDepth: 1 },
      ],
      conversations,
    );
    expect(withNoSessions[0].sessionId).toBe("a1");
    expect(withMany(withManySessions)).toBe("a1");
    function withMany(rows: typeof withManySessions) {
      return rows[0].sessionId;
    }
  });
});
