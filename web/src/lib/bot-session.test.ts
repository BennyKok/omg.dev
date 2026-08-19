import { describe, expect, test } from "bun:test";
import { findBotMainSession } from "./bot-session";

describe("findBotMainSession", () => {
  test("prefers the bot's exact saved session over an earlier child", () => {
    const child = {
      sessionId: "child",
      botId: "bot-1",
      parentSessionId: "main",
      subagentDepth: 1,
    };
    const main = { sessionId: "main", botId: "bot-1" };

    expect(findBotMainSession({ id: "bot-1", sessionId: "main" }, [child, main])).toBe(main);
  });

  test("uses a top-level bot session when the bot has no saved session yet", () => {
    const child = {
      sessionId: "child",
      botId: "bot-1",
      parentNativeSessionId: "main",
    };
    const main = { sessionId: "main", botId: "bot-1" };

    expect(findBotMainSession({ id: "bot-1" }, [child, main])).toBe(main);
  });

  test("never falls back to a child-only match", () => {
    const child = {
      sessionId: "child",
      botId: "bot-1",
      subagentDepth: 1,
    };

    expect(findBotMainSession({ id: "bot-1" }, [child])).toBeUndefined();
  });
});
