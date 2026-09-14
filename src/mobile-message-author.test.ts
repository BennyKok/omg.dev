import { describe, expect, test } from "bun:test";
import { messageSpeaker, otherMessageSender, type ChatIdentity } from "../mobile/src/omg/message-author";
import type { ConversationParticipant, MessageAuthorRef } from "./conversation-contract";

const person: ConversationParticipant = {
  id: "human:alex", kind: "human", role: "member", display: { name: "Alex", fallback: "Member", avatar: "https://example.com/alex.png" },
  joinedAt: 0, historyAccess: "all",
};
const identity: ChatIdentity = {
  viewerParticipantId: "human:me",
  conversation: { id: "chat", participants: [person], runtimeSessions: [], createdAt: 0, updatedAt: 0 },
};
const human = (participantId: string): MessageAuthorRef => ({ kind: "human", participantId, verified: true });

describe("mobile message attribution", () => {
  test("sender chrome renders in isolation from native modules", () => {
    const result = Bun.spawnSync(["bun", "test", "./scripts/human-message-frame.native-check.tsx"], { cwd: "mobile", stdout: "pipe", stderr: "pipe" });
    if (result.exitCode) console.error(new TextDecoder().decode(result.stderr));
    expect(result.exitCode).toBe(0);
  });
  test("other people's messages resolve the server profile, including departed members", () => {
    expect(otherMessageSender({ role: "user", author: human(person.id) }, identity)).toBe(person);
    const departed = { ...person, leftAt: 123 };
    expect(otherMessageSender({ role: "user", author: human(person.id) }, {
      ...identity, conversation: { ...identity.conversation!, participants: [departed] },
    })).toBe(departed);
  });
  test("own, unknown, and nonhuman messages never get another person's avatar", () => {
    for (const author of [undefined, human("human:me"), { kind: "legacy", participantId: "legacy:unknown", verified: false } as const, { kind: "bot", participantId: "bot:test", verified: true } as const]) {
      expect(otherMessageSender({ role: "user", author }, identity)).toBeNull();
    }
    expect(otherMessageSender({ role: "assistant", author: human(person.id) }, identity)).toBeNull();
    expect(otherMessageSender({ role: "user", author: human(person.id) }, { ...identity, viewerParticipantId: null })).toBeNull();
  });
  test("a missing profile gets Member, without inventing a name or photo", () => {
    expect(otherMessageSender({ role: "user", author: human("human:gone") }, identity)?.display).toEqual({ fallback: "Member" });
  });
  test("consecutive messages from different people never share a speaker run", () => {
    expect(messageSpeaker({ role: "user", author: human(person.id) })).toBe("user:human:alex");
    expect(messageSpeaker({ role: "user", author: human("human:me") })).not.toBe(messageSpeaker({ role: "user", author: human(person.id) }));
    expect(messageSpeaker({ role: "user" })).toBe("user");
  });
});
