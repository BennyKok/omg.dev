import { describe, expect, test } from "bun:test";
import { BOT_UNREAD_DOT_CLASS, botConversationRows, botUnreadActionForTranscript, hasUnreadBotConversation } from "./bot-unread";

describe("bot conversation unread presentation", () => {
  test("gives one bot one row, backed by its configured primary", () => {
    // "two" is a second top-level session the bot once used. It must not
    // become a second row, and its unread flag must not leak onto the row the
    // human actually opens.
    const rows = botConversationRows(
      [{ id: "bot", sessionId: "one" }],
      [{ sessionId: "one", botId: "bot" }, { sessionId: "two", botId: "bot" }],
      [
        { sessionId: "one", botId: "bot", unread: false },
        { sessionId: "two", botId: "bot", unread: true },
      ],
    );
    expect(rows.map((row) => [row.sessionId, row.unread])).toEqual([["one", false]]);
  });

  test("marks the row unread from the canonical conversation only", () => {
    const rows = botConversationRows(
      [{ id: "bot", sessionId: "one" }],
      [
        { sessionId: "one", botId: "bot" },
        { sessionId: "child", botId: "bot", parentSessionId: "one", spawnedBy: "subagent" },
      ],
      [
        { sessionId: "one", botId: "bot", unread: true },
        { sessionId: "child", botId: "bot", unread: false },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].unread).toBe(true);
    expect(rows[0].sessionId).toBe("one");
  });

  test("clearing one bot leaves the other bot's unread row alone", () => {
    const bots = [{ id: "a", sessionId: "a1" }, { id: "b", sessionId: "b1" }];
    const sessions = [{ sessionId: "a1", botId: "a" }, { sessionId: "b1", botId: "b" }];
    // "a" was just opened and cleared; "b" is still unread.
    const rows = botConversationRows(bots, sessions, [
      { sessionId: "a1", botId: "a", unread: false },
      { sessionId: "b1", botId: "b", unread: true },
    ]);
    expect(rows.map((row) => [row.bot.id, row.unread])).toEqual([["a", false], ["b", true]]);
  });

  test("keeps roster order stable and one row per bot as sessions churn", () => {
    const bots = [{ id: "a", sessionId: "a1" }, { id: "b", sessionId: "b1" }];
    const base = [{ sessionId: "a1", botId: "a" }, { sessionId: "b1", botId: "b" }];
    const withChildren = [
      { sessionId: "b-child", botId: "b", parentSessionId: "b1", subagentDepth: 1 },
      ...base,
      { sessionId: "a-child", botId: "a", parentSessionId: "a1", subagentDepth: 1 },
    ];
    const keys = (sessions: typeof withChildren) =>
      botConversationRows(bots, sessions, []).map((row) => row.key);
    expect(keys(base)).toEqual(["bot:a", "bot:b"]);
    expect(keys(withChildren)).toEqual(["bot:a", "bot:b"]);
  });

  test("keeps an unstarted bot as one readable row", () => {
    expect(botConversationRows([{ id: "new" }], [], [])).toMatchObject([
      { key: "bot:new", sessionId: null, unread: false },
    ]);
  });

  test("routes websocket assistant output to refresh or active-view suppression", () => {
    expect(botUnreadActionForTranscript({ role: "user", conversationId: "one", selectedConversationId: null, botsVisible: false })).toBe("ignore");
    expect(botUnreadActionForTranscript({ role: "assistant", conversationId: "one", selectedConversationId: "two", botsVisible: true })).toBe("refresh");
    expect(botUnreadActionForTranscript({ role: "assistant", conversationId: "one", selectedConversationId: "one", botsVisible: true })).toBe("mark-read");
    expect(botUnreadActionForTranscript({ role: "user", text: "[Peer message from A (a) to B (b)]", conversationId: "one", selectedConversationId: null, botsVisible: false })).toBe("refresh");
  });

  test("uses one quiet dot convention for aggregate, mobile rows, and desktop rows", () => {
    expect(BOT_UNREAD_DOT_CLASS).toContain("size-2");
    expect(BOT_UNREAD_DOT_CLASS).toContain("rounded-full");
  });
});
