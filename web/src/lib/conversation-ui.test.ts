import { describe, expect, test } from "bun:test";
import { activeConversationParticipants, isBotConversation, productBotId } from "./conversation-ui";
import type { Conversation } from "../../../src/conversation-contract";

function conversation(): Conversation {
  return {
    id: "conversation-1",
    participants: [
      {
        id: "human:member",
        kind: "human",
        role: "owner",
        display: { name: "Member", fallback: "Member" },
        joinedAt: 1,
        historyAccess: "all",
      },
      {
        id: "bot:scout",
        kind: "bot",
        role: "member",
        display: { name: "Scout", fallback: "Scout" },
        joinedAt: 1,
        historyAccess: "all",
      },
      {
        id: "bot:analyst",
        kind: "bot",
        role: "member",
        display: { name: "Analyst", fallback: "Analyst" },
        joinedAt: 2,
        historyAccess: "all",
      },
    ],
    runtimeSessions: [
      { sessionId: "primary", participantId: "bot:scout", kind: "primary", attachedAt: 1 },
      { sessionId: "child", participantId: "bot:scout", kind: "execution", attachedAt: 2 },
    ],
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("conversation product routing", () => {
  test("uses the primary participant instead of a conflicting runtime botId", () => {
    expect(productBotId({ sessionId: "primary", conversation: conversation(), botId: "wrong" })).toBe("scout");
  });

  test("a child execution cannot select a different product surface", () => {
    expect(productBotId({ sessionId: "child", conversation: conversation(), botId: "child-bot" })).toBe("scout");
  });

  test("a typed regular conversation ignores stale Session.botId", () => {
    const regular = conversation();
    regular.participants = regular.participants.filter((participant) => participant.kind === "human");
    expect(productBotId({ sessionId: "primary", conversation: regular, botId: "stale" })).toBeNull();
    expect(isBotConversation({ sessionId: "primary", conversation: regular, botId: "stale" })).toBe(false);
  });

  test("keeps legacy routing until the typed conversation arrives", () => {
    expect(productBotId({ sessionId: "legacy", botId: "scout" })).toBe("scout");
  });

  test("returns the full active multi-bot roster and excludes departed members", () => {
    const row = conversation();
    row.participants[2].leftAt = 3;
    expect(activeConversationParticipants({ conversation: row }).map((participant) => participant.display.fallback)).toEqual([
      "Member",
      "Scout",
    ]);
  });
});
