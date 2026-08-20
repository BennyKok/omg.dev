import { describe, expect, test } from "bun:test";
import {
  activeConversationParticipants,
  conversationParticipantById,
  conversationParticipantDisplayName,
  isBotConversation,
  isOtherHumanMessageAuthor,
  productBotId,
  unknownConversationParticipant,
} from "./conversation-ui";
import type { Conversation, MessageAuthorRef } from "../../../src/conversation-contract";

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

const VERIFIED_HUMAN = (participantId: string): MessageAuthorRef => ({
  kind: "human",
  participantId,
  verified: true,
});
const VERIFIED_BOT = (participantId: string): MessageAuthorRef => ({
  kind: "bot",
  participantId,
  verified: true,
});
const LEGACY_UNKNOWN: MessageAuthorRef = { kind: "legacy", participantId: "legacy:unknown", verified: false };

describe("own-vs-other-human message authorship (message-level avatar split)", () => {
  test("a verified author that matches the viewer is the viewer's own turn", () => {
    expect(isOtherHumanMessageAuthor(VERIFIED_HUMAN("human:member"), "human:member")).toBe(false);
  });

  test("a verified author that differs from the viewer is someone else's turn", () => {
    expect(isOtherHumanMessageAuthor(VERIFIED_HUMAN("human:angel"), "human:member")).toBe(true);
  });

  test("a bot author is never the 'other human' case, even if ids happened to collide", () => {
    expect(isOtherHumanMessageAuthor(VERIFIED_BOT("bot:scout"), "bot:scout")).toBe(false);
  });

  test("an unresolved historical turn is never treated as someone else's", () => {
    // The pre-feature transcript and any turn the server could not verify —
    // rendering it as "someone else" would draw an avatar the server never
    // actually claimed, which is worse than the existing unattributed look.
    expect(isOtherHumanMessageAuthor(LEGACY_UNKNOWN, "human:member")).toBe(false);
    expect(isOtherHumanMessageAuthor(undefined, "human:member")).toBe(false);
  });

  test("an unknown viewer never turns every message into 'someone else's'", () => {
    // If bootstrap could not resolve "who am I" (viewerParticipantId is
    // null), the safe default is "unknown", not "everyone but me" — otherwise
    // the viewer's own turns would grow a redundant avatar.
    expect(isOtherHumanMessageAuthor(VERIFIED_HUMAN("human:member"), null)).toBe(false);
    expect(isOtherHumanMessageAuthor(VERIFIED_HUMAN("human:member"), undefined)).toBe(false);
  });
});

describe("resolving a message sender's display info", () => {
  test("looks the author's participant id up in the conversation roster", () => {
    const row = conversation();
    const found = conversationParticipantById(row, "human:member");
    expect(found?.display.fallback).toBe("Member");
  });

  test("a participant id absent from the roster (left, or never synced) resolves to nothing", () => {
    expect(conversationParticipantById(conversation(), "human:ghost")).toBeUndefined();
  });

  test("no conversation object resolves to nothing rather than throwing", () => {
    expect(conversationParticipantById(null, "human:member")).toBeUndefined();
    expect(conversationParticipantById(undefined, "human:member")).toBeUndefined();
  });

  test("prefers the profile display name, falling back to the server's explicit fallback", () => {
    const row = conversation();
    expect(conversationParticipantDisplayName(row.participants[0])).toBe("Member");
    row.participants[0].display.name = "  Angel  ";
    expect(conversationParticipantDisplayName(row.participants[0])).toBe("Angel");
    row.participants[0].display.name = "   ";
    expect(conversationParticipantDisplayName(row.participants[0])).toBe("Member");
  });

  test("a deleted/unreachable profile gets an honest generic fallback, not a guessed name", () => {
    const ghost = unknownConversationParticipant("human:ghost");
    expect(ghost.id).toBe("human:ghost");
    expect(ghost.kind).toBe("human");
    expect(conversationParticipantDisplayName(ghost)).toBe("Member");
    expect(ghost.display.avatar).toBeUndefined();
  });
});
