import { describe, expect, test } from "bun:test";
import {
  activeConversationParticipants,
  conversationParticipantById,
  conversationParticipantDisplayName,
  isBotConversation,
  isOtherHumanMessageAuthor,
  productBotId,
  renderedBotId,
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

// The reported bug: the "Engineer" bot's roster row resolved a real,
// verified canonical sessionId (via botCanonicalSessionId / botStageSession —
// see bot-stage-session.test.ts), but the desktop stage column then
// re-derived identity from that session's own `conversation` snapshot via
// productBotId, which can disagree with the verified resolution — a rotated
// / nested / child / same-name / already-open-regular session's runtime
// attachment shows up in this exact session's `conversation` object, and
// productBotId, seeing no confirmed active bot on it, falls back to the
// harness's generic chrome even though the caller already knows this is the
// bot's own column. renderedBotId is the fix: a trusted id from navigation
// wins outright over whatever this session's own data would derive.
describe("renderedBotId — trusted navigation identity vs. re-derived session data", () => {
  test("undefined trustedBotId is unchanged: falls through to productBotId (regular sessions keep existing UI)", () => {
    expect(renderedBotId({ sessionId: "primary", conversation: conversation() }, undefined)).toBe("scout");
    expect(renderedBotId({ sessionId: "legacy", botId: "scout" }, undefined)).toBe("scout");
    const regular = conversation();
    regular.participants = regular.participants.filter((participant) => participant.kind === "human");
    expect(renderedBotId({ sessionId: "primary", conversation: regular, botId: "stale" }, undefined)).toBeNull();
  });

  test("a trusted id overrides a WRONG botId productBotId would have derived from this session's own data", () => {
    // productBotId on its own would resolve "scout" (the conversation's
    // active bot) — the caller's verified resolution (a different bot
    // entirely) must win instead of being second-guessed.
    expect(productBotId({ sessionId: "primary", conversation: conversation() })).toBe("scout");
    expect(renderedBotId({ sessionId: "primary", conversation: conversation() }, "engineer")).toBe("engineer");
  });

  test("a NESTED/CHILD session's runtime attachment does not decide the surface once trusted", () => {
    // Simulates the unfinished-rotation shape: the resolved canonical session
    // ("engineer-new") is not the one the conversation's runtimeSessions
    // still calls "primary" (a stale/rotated-out id), and — unlike the
    // single-bot conversation() fixture — this conversation has no active
    // bot participant at all (the case productBotId cannot see past).
    const nested: Conversation = {
      id: "conv-engineer",
      participants: [
        { id: "human:member", kind: "human", role: "owner", display: { name: "Member", fallback: "Member" }, joinedAt: 1, historyAccess: "all" },
      ],
      runtimeSessions: [
        { sessionId: "engineer-old", participantId: "bot:engineer", kind: "primary", attachedAt: 1 },
        { sessionId: "engineer-child", participantId: "bot:engineer", kind: "execution", attachedAt: 2 },
      ],
      createdAt: 1,
      updatedAt: 2,
    };
    const session = { sessionId: "engineer-new", conversation: nested, botId: "engineer" };
    // Without a trusted id, productBotId cannot confirm this exact session
    // against the conversation snapshot and falls back to generic chrome.
    expect(productBotId(session)).toBeNull();
    // The bot-stage column already knows the answer from navigation.
    expect(renderedBotId(session, "engineer")).toBe("engineer");
  });

  test("a SAME-NAME/already-open regular session's stale botId is not trusted just because it is undefined-passed", () => {
    // A regular session that happens to carry a stale inherited botId (e.g.
    // reused sessionId, or a bot that later left) must still show regular
    // UI when nothing has resolved a trusted bot for this render.
    const left = conversation();
    left.participants = left.participants.map((participant) =>
      participant.kind === "bot" ? { ...participant, leftAt: 5 } : participant,
    );
    const session = { sessionId: "primary", conversation: left, botId: "scout" };
    expect(renderedBotId(session, undefined)).toBeNull();
    // But once a caller resolves and trusts an id explicitly, that decision
    // is authoritative even over a conversation that looks "regular".
    expect(renderedBotId(session, "scout")).toBe("scout");
  });

  test("an explicit null trustedBotId forces regular chrome even when the session's own data would resolve a bot", () => {
    expect(renderedBotId({ sessionId: "primary", conversation: conversation() }, null)).toBeNull();
  });
});
