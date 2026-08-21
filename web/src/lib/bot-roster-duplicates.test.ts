import { describe, expect, test } from "bun:test";
import { botConversationRows } from "./bot-unread";

// Negative control for the v0.2.9 roster bug, built from the reported screenshot.
//
// Three bots on that roster each rendered twice — "Bot Improver", "iOS
// Manager", "Landing + Funnel Optimization" — because each had delegated a
// background session, and a delegated child inherits its parent's `botId`.
// The fixture below is that exact shape: one primary conversation and one
// child per bot. Before the fix this produced six rows with three repeated
// names; the roster invariant is three.
const BOTS = [
  { id: "bot-improver", sessionId: "improver-main" },
  { id: "ios-manager", sessionId: "ios-main" },
  { id: "landing-funnel", sessionId: "landing-main" },
];

const SESSIONS = [
  { sessionId: "improver-main", botId: "bot-improver" },
  { sessionId: "improver-child", botId: "bot-improver", parentSessionId: "improver-main", spawnedBy: "subagent" },
  { sessionId: "ios-main", botId: "ios-manager" },
  { sessionId: "ios-child", botId: "ios-manager", parentSessionId: "ios-main", spawnedBy: "subagent" },
  { sessionId: "landing-main", botId: "landing-funnel" },
  { sessionId: "landing-child", botId: "landing-funnel", parentSessionId: "landing-main", spawnedBy: "subagent" },
];

const CONVERSATIONS = SESSIONS.map((session) => ({
  sessionId: session.sessionId,
  botId: session.botId,
  unread: false,
}));

describe("bots roster duplicate rows (screenshot regression)", () => {
  test("renders exactly one row per bot when each bot has a delegated child", () => {
    const rows = botConversationRows(BOTS, SESSIONS, CONVERSATIONS);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.bot.id)).toEqual(["bot-improver", "ios-manager", "landing-funnel"]);
  });

  test("never backs a roster row with a delegated child session", () => {
    const rows = botConversationRows(BOTS, SESSIONS, CONVERSATIONS);
    expect(rows.map((row) => row.sessionId)).toEqual(["improver-main", "ios-main", "landing-main"]);
  });

  test("shows no bot name twice", () => {
    const ids = botConversationRows(BOTS, SESSIONS, CONVERSATIONS).map((row) => row.bot.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
