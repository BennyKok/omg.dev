import { describe, expect, test } from "bun:test";
import { BOT_UNREAD_DOT_CLASS, botConversationRows, botUnreadActionForTranscript, hasUnreadBotConversation } from "./bot-unread";

describe("bot conversation unread presentation", () => {
  test("keeps two conversations for one bot isolated", () => {
    const rows = botConversationRows(
      [{ id: "bot", sessionId: "one" }],
      [{ sessionId: "one", botId: "bot" }, { sessionId: "two", botId: "bot" }],
      [
        { sessionId: "one", botId: "bot", unread: false },
        { sessionId: "two", botId: "bot", unread: true },
      ],
    );
    expect(rows.map((row) => [row.sessionId, row.unread])).toEqual([["one", false], ["two", true]]);
    expect(hasUnreadBotConversation(rows.flatMap((row) => row.sessionId ? [{ sessionId: row.sessionId, botId: row.bot.id, unread: row.unread }] : []))).toBe(true);
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
