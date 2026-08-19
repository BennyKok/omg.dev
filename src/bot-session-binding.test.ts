// A bot must never be bound to a task it delegated.
//
// The live failure this covers: a bot's conversation process died while two of
// its subagents kept running. A broad `botId` match picked a surviving child
// (children inherit `botId` for attribution), the child's id was persisted onto
// the bot record, and from then on the bot chat opened a delegated
// acceptance-test run. The human's messages queued behind that task's turn, and
// nothing in the UI led back to the real conversation.
import { describe, expect, test } from "bun:test";

import {
  botConversationRef,
  findBotMainSession,
  isDelegatedSession,
} from "./bots/session.ts";

const CONVERSATION = "5f1df640-20fd-4c9f-a605-e4091890b003";
const CHILD = "58c974e7-feee-49b3-ab4d-1012b4250b1c";

describe("isDelegatedSession", () => {
  test("treats any lineage marker as delegated", () => {
    expect(isDelegatedSession({ parentSessionId: "p" })).toBe(true);
    expect(isDelegatedSession({ parentNativeSessionId: "p" })).toBe(true);
    expect(isDelegatedSession({ subagentDepth: 1 })).toBe(true);
    expect(isDelegatedSession({ spawnedBy: "subagent" })).toBe(true);
  });

  test("a bot's own conversation is not delegated", () => {
    expect(isDelegatedSession({ sessionId: CONVERSATION, botId: "bot-1", spawnedBy: "bot" }))
      .toBe(false);
  });
});

describe("findBotMainSession", () => {
  test("ignores a saved id that names one of the bot's own subagents", () => {
    const child = {
      sessionId: CHILD,
      botId: "bot-1",
      parentSessionId: CONVERSATION,
      spawnedBy: "subagent",
    };
    const conversation = { sessionId: CONVERSATION, botId: "bot-1", spawnedBy: "bot" };

    expect(findBotMainSession({ id: "bot-1", sessionId: CHILD }, [child, conversation]))
      .toBe(conversation);
  });

  test("returns nothing rather than a child when the conversation is not live", () => {
    const child = {
      sessionId: CHILD,
      botId: "bot-1",
      parentSessionId: CONVERSATION,
      spawnedBy: "subagent",
    };

    expect(findBotMainSession({ id: "bot-1", sessionId: CHILD }, [child])).toBeUndefined();
  });

  test("a child listed before the conversation never wins", () => {
    const child = { sessionId: CHILD, botId: "bot-1", subagentDepth: 1 };
    const conversation = { sessionId: CONVERSATION, botId: "bot-1" };

    expect(findBotMainSession({ id: "bot-1" }, [child, conversation])).toBe(conversation);
  });
});

describe("botConversationRef", () => {
  test("keeps a healthy saved conversation untouched", () => {
    const conversation = { sessionId: CONVERSATION, botId: "bot-1" };

    expect(botConversationRef({ id: "bot-1", sessionId: CONVERSATION }, [conversation]))
      .toEqual({ sessionId: CONVERSATION });
  });

  test("keeps a saved conversation whose process has already exited", () => {
    expect(botConversationRef({ id: "bot-1", sessionId: CONVERSATION }, []))
      .toEqual({ sessionId: CONVERSATION });
  });

  test("recovers the real conversation id from a child binding", () => {
    // The parent process is gone — which is exactly why the rebind happened —
    // so the id has to come from the child's lineage, not from the live list.
    const child = {
      sessionId: CHILD,
      botId: "bot-1",
      parentSessionId: CONVERSATION,
      spawnedBy: "subagent",
    };

    expect(botConversationRef({ id: "bot-1", sessionId: CHILD }, [child]))
      .toEqual({ sessionId: CONVERSATION });
  });

  test("walks past a nested child to the root conversation", () => {
    const grandchild = { sessionId: "grandchild", parentSessionId: CHILD, subagentDepth: 2 };
    const child = { sessionId: CHILD, parentSessionId: CONVERSATION, subagentDepth: 1 };
    const conversation = { sessionId: CONVERSATION, botId: "bot-1" };

    expect(botConversationRef({ id: "bot-1", sessionId: "grandchild" }, [grandchild, child, conversation]))
      .toEqual({ sessionId: CONVERSATION });
  });

  test("mints a fresh conversation when a child has no recoverable ancestor", () => {
    const orphan = { sessionId: CHILD, botId: "bot-1", subagentDepth: 1 };

    expect(botConversationRef({ id: "bot-1", sessionId: CHILD }, [orphan])).toEqual({});
  });

  test("does not spin on a parent cycle", () => {
    const a = { sessionId: "a", parentSessionId: "b", subagentDepth: 1 };
    const b = { sessionId: "b", parentSessionId: "a", subagentDepth: 1 };

    expect(botConversationRef({ id: "bot-1", sessionId: "a" }, [a, b])).toEqual({});
  });

  test("a bot nobody has talked to yet has no conversation to repair", () => {
    expect(botConversationRef({ id: "bot-1" }, [])).toEqual({});
    expect(botConversationRef({ id: "bot-1", sessionId: "   " }, [])).toEqual({});
  });
});
