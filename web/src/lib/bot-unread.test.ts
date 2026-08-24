import { describe, expect, test } from "bun:test";
import {
  BOT_UNREAD_DOT_CLASS,
  botConversationRows,
  botRosterActivityState,
  botRosterRowAriaLabel,
  botUnreadActionForTranscript,
  hasUnreadBotConversation,
} from "./bot-unread";

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

  test("orders the bot roster by most recent conversation", () => {
    const rows = botConversationRows(
      [
        { id: "old", sessionId: "old-1", lastMessageAt: 5 },
        { id: "new", sessionId: "new-1", lastMessageAt: 6 },
        { id: "unstarted" },
      ],
      [
        { sessionId: "old-1", botId: "old" },
        { sessionId: "new-1", botId: "new" },
      ],
      [
        { sessionId: "old-1", botId: "old", unread: false, lastMessageTs: 10 },
        { sessionId: "new-1", botId: "new", unread: false, lastMessageTs: 20 },
      ],
    );

    expect(rows.map((row) => row.bot.id)).toEqual(["new", "old", "unstarted"]);
  });

  // The server resolves the bot's conversation against every session it knows;
  // this client only has the fleet list it is holding. A bot whose conversation
  // is not in that list resolves differently on the two sides, and the row then
  // matched no server conversation at all — rendering read, with no preview,
  // for a bot with unread messages waiting.
  test("still reports unread when the client resolves a different session", () => {
    const rows = botConversationRows(
      // Saved id "gone" is not in this client's session list at all.
      [{ id: "bot", sessionId: "gone" }],
      [],
      [
        {
          sessionId: "live",
          conversationId: "conv",
          botId: "bot",
          unread: true,
          lastMessagePreview: "still here",
          lastMessageTs: 7,
        },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].unread).toBe(true);
    expect(rows[0].lastMessagePreview).toBe("still here");
    // The id the row opens comes from the same conversation its unread state
    // came from, so the dot and the thread can never be two different sessions.
    expect(rows[0].sessionId).toBe("live");
    expect(rows[0].conversationId).toBe("conv");
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

  test("uses one visible dot convention for aggregate, mobile rows, and desktop rows", () => {
    expect(BOT_UNREAD_DOT_CLASS).toContain("size-2.5");
    expect(BOT_UNREAD_DOT_CLASS).toContain("rounded-full");
    expect(BOT_UNREAD_DOT_CLASS).toContain("ring-primary/20");
  });

  test("keeps activity and read state explicit and independent", () => {
    expect(botRosterActivityState(true, true)).toBe("working");
    expect(botRosterActivityState(true, false)).toBe("idle");
    expect(botRosterActivityState(false, true)).toBe("disabled");

    expect(
      botRosterRowAriaLabel({ name: "Scout", enabled: true, working: false, unread: true }),
    ).toBe("Scout, idle, unread conversation");
    expect(
      botRosterRowAriaLabel({ name: "Scout", enabled: true, working: true, unread: false }),
    ).toBe("Scout, working, read conversation");
  });
});
