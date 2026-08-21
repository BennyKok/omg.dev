import { describe, expect, test } from "bun:test";
import { botCanonicalSessionId, isDelegatedSession } from "./bots/session.ts";

// One roster row per bot, backed by that bot's canonical conversation.
// The cases below are the shapes that produced duplicate rows in v0.2.9.

const main = { sessionId: "main", botId: "bot-1" };

describe("botCanonicalSessionId", () => {
  test("keeps the configured primary when a bot has a delegated child", () => {
    const child = { sessionId: "child", botId: "bot-1", parentSessionId: "main", spawnedBy: "subagent" };
    expect(botCanonicalSessionId({ id: "bot-1", sessionId: "main" }, [child, main])).toBe("main");
  });

  test("ignores a nested grandchild at any depth", () => {
    const child = { sessionId: "child", botId: "bot-1", parentSessionId: "main", subagentDepth: 1 };
    const grandchild = { sessionId: "grandchild", botId: "bot-1", parentSessionId: "child", subagentDepth: 2 };
    const greatgrandchild = { sessionId: "ggchild", botId: "bot-1", parentSessionId: "grandchild", subagentDepth: 3 };
    const sessions = [greatgrandchild, grandchild, child, main];
    expect(botCanonicalSessionId({ id: "bot-1", sessionId: "main" }, sessions)).toBe("main");
    // Every descendant is recognised as delegated, so none can back a row.
    for (const session of [child, grandchild, greatgrandchild]) {
      expect(isDelegatedSession(session)).toBe(true);
    }
  });

  test("repairs a primary that was rebound onto a child, up to the root", () => {
    const child = { sessionId: "child", botId: "bot-1", parentSessionId: "main", subagentDepth: 1 };
    const grandchild = { sessionId: "grandchild", botId: "bot-1", parentSessionId: "child", subagentDepth: 2 };
    // The bot record points at the grandchild — the corrupt-binding case.
    expect(botCanonicalSessionId({ id: "bot-1", sessionId: "grandchild" }, [grandchild, child, main])).toBe("main");
  });

  test("collapses several stale top-level sessions to one stable choice", () => {
    const a = { sessionId: "aaa", botId: "bot-1" };
    const b = { sessionId: "bbb", botId: "bot-1" };
    const c = { sessionId: "ccc", botId: "bot-1" };
    const bot = { id: "bot-1" };
    const first = botCanonicalSessionId(bot, [a, b, c]);
    // Same answer whatever order the fleet listed them in.
    expect(botCanonicalSessionId(bot, [c, a, b])).toBe(first);
    expect(botCanonicalSessionId(bot, [b, c, a])).toBe(first);
    expect(first).toBe("aaa");
  });

  test("falls back to a true top-level session when the configured primary is missing", () => {
    const child = { sessionId: "child", botId: "bot-1", parentSessionId: "gone", spawnedBy: "subagent" };
    const live = { sessionId: "live", botId: "bot-1" };
    // The bot has no saved binding at all.
    expect(botCanonicalSessionId({ id: "bot-1" }, [child, live])).toBe("live");
  });

  test("never chooses a child when only children are live", () => {
    const child = { sessionId: "child", botId: "bot-1", parentSessionId: "dead", subagentDepth: 1 };
    expect(botCanonicalSessionId({ id: "bot-1" }, [child])).toBeNull();
  });

  test("keeps a stale configured primary whose transcript is still on disk", () => {
    // Nothing live matches, but the saved id is where the history is filed.
    expect(botCanonicalSessionId({ id: "bot-1", sessionId: "archived" }, [])).toBe("archived");
  });

  test("returns null for a bot that has never held a conversation", () => {
    expect(botCanonicalSessionId({ id: "fresh" }, [])).toBeNull();
  });

  test("keeps bots isolated from each other's sessions and children", () => {
    const sessions = [
      { sessionId: "a-main", botId: "bot-a" },
      { sessionId: "a-child", botId: "bot-a", parentSessionId: "a-main", spawnedBy: "subagent" },
      { sessionId: "b-main", botId: "bot-b" },
      { sessionId: "b-child", botId: "bot-b", parentSessionId: "b-main", spawnedBy: "subagent" },
    ];
    expect(botCanonicalSessionId({ id: "bot-a", sessionId: "a-main" }, sessions)).toBe("a-main");
    expect(botCanonicalSessionId({ id: "bot-b", sessionId: "b-main" }, sessions)).toBe("b-main");
  });

  test("treats a delegate/auto child as delegated, not as a bot conversation", () => {
    const delegated = { sessionId: "d", botId: "bot-1", parentNativeSessionId: "main" };
    expect(isDelegatedSession(delegated)).toBe(true);
    expect(botCanonicalSessionId({ id: "bot-1", sessionId: "main" }, [delegated, main])).toBe("main");
  });

  // The reported routing bug: an ordinary chat already open under a sessionId
  // that now happens to equal the bot's saved (stale) id must never be
  // adopted as the bot's roster row just because the id matches and the
  // session is live and not delegated.
  test("never adopts an already-open regular chat that reuses the saved id", () => {
    const regularChat = { sessionId: "main" };
    expect(botCanonicalSessionId({ id: "bot-1", sessionId: "main" }, [regularChat])).toBeNull();
  });

  test("falls through to the bot's own live session when the saved id was reused elsewhere", () => {
    const regularChat = { sessionId: "main" };
    const own = { sessionId: "own-live", botId: "bot-1" };
    expect(botCanonicalSessionId({ id: "bot-1", sessionId: "main" }, [regularChat, own]))
      .toBe("own-live");
  });
});
