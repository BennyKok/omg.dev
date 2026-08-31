import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  authoredSendParticipantId,
  forgetAuthoredSends,
  recordAuthoredSend,
  resetAuthoredSendsForTests,
  sendDigest,
} from "./conversation-authorship.ts";
import {
  conversationForSession,
  conversationHumanParticipantId,
  ensureConversationHuman,
  messageAuthorForSession,
  migrateLegacyConversations,
  resetConversationsForTests,
} from "./conversations.ts";
import { formatBotAttribution } from "./bots/authorship.ts";
import {
  indexedMessagePage,
  indexSessionMessagesDirect,
  resetTranscriptIndexConnectionForTests,
} from "./transcript-index.ts";
import type { SessionMsg } from "./sessions.ts";

const originalData = PATHS.data;
let root = "";

const OWNER = "benny@example.com";
const GUEST = "guest@example.com";
const ownerId = () => conversationHumanParticipantId(OWNER);
const guestId = () => conversationHumanParticipantId(GUEST);

/** A plain coding session, tagged to its creator, exactly as listSessions builds it. */
function regularSession(sessionId: string, assignedUser: string | null = OWNER) {
  migrateLegacyConversations({
    sessions: [{ sessionId, assignedUser, startedAt: 1_000, title: "work" } as never],
    bots: [],
    roster: [
      { email: OWNER, name: "Benny", avatar: "/api/avatars/benny.png" },
      { email: GUEST, name: "Guest", avatar: "/api/avatars/guest.png" },
    ],
    now: 2_000,
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omg-authorship-"));
  (PATHS as { data: string }).data = root;
  resetConversationsForTests();
  resetAuthoredSendsForTests();
  resetTranscriptIndexConnectionForTests();
});

afterEach(() => {
  resetTranscriptIndexConnectionForTests();
  (PATHS as { data: string }).data = originalData;
  rmSync(root, { recursive: true, force: true });
});

describe("the digest is the join key across the agent transcript round trip", () => {
  test("ignores the whitespace an agent transcript may add or drop", () => {
    expect(sendDigest("ship it")).toBe(sendDigest("  ship it\n"));
  });

  test("separates different text, and refuses to key on empty text", () => {
    expect(sendDigest("ship it")).not.toBe(sendDigest("ship them"));
    expect(sendDigest("   ")).toBe("");
  });
});

describe("a verified send attributes an ordinary coding-session turn", () => {
  test("the sender's own turn resolves to a verified author with no marker in the text", () => {
    regularSession("sess-1");
    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "fix the flaky test" });

    // The text reaching the transcript is exactly what the agent was given.
    // Nothing was prefixed onto it.
    const author = messageAuthorForSession("sess-1", { role: "user", text: "fix the flaky test" });
    expect(author).toEqual({ kind: "human", participantId: guestId(), verified: true });
  });

  test("an unrecorded turn in the same session stays the honest unknown", () => {
    regularSession("sess-1");
    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "fix the flaky test" });

    const author = messageAuthorForSession("sess-1", { role: "user", text: "something nobody sent" });
    expect(author.verified).toBe(false);
    expect(author.kind).toBe("legacy");
  });

  test("attribution does not leak across sessions that saw identical text", () => {
    regularSession("sess-1");
    regularSession("sess-2");
    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "run the tests" });

    expect(messageAuthorForSession("sess-1", { role: "user", text: "run the tests" }).verified).toBe(true);
    expect(messageAuthorForSession("sess-2", { role: "user", text: "run the tests" }).verified).toBe(false);
  });

  test("survives a reindex, because nothing about the key depends on row order", () => {
    regularSession("sess-1");
    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "deploy" });
    const first = messageAuthorForSession("sess-1", { role: "user", text: "deploy" });
    const second = messageAuthorForSession("sess-1", { role: "user", text: "deploy" });
    expect(second).toEqual(first);
    expect(second.verified).toBe(true);
  });
});

describe("the lookup index cannot go stale", () => {
  // The lookup is cached and rebuilt on file change, because a reindex calls it
  // once per message. A cache that misses an invalidation, or that builds its
  // keys differently from the way it reads them, fails exactly here.
  test("a send recorded after an earlier lookup is visible to the next one", () => {
    regularSession("sess-1");
    expect(authoredSendParticipantId("sess-1", "later")).toBeNull();

    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "later" });
    expect(authoredSendParticipantId("sess-1", "later")).toBe(guestId());
  });

  test("a second author arriving after a lookup turns the answer ambiguous", () => {
    regularSession("sess-1");
    recordAuthoredSend({ sessionId: "sess-1", participantId: ownerId(), text: "ok" });
    expect(authoredSendParticipantId("sess-1", "ok")).toBe(ownerId());

    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "ok" });
    expect(authoredSendParticipantId("sess-1", "ok")).toBeNull();
  });

  test("forgetting a session is visible to the next lookup", () => {
    regularSession("sess-1");
    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "gone" });
    expect(authoredSendParticipantId("sess-1", "gone")).toBe(guestId());

    forgetAuthoredSends("sess-1");
    expect(authoredSendParticipantId("sess-1", "gone")).toBeNull();
  });
});

describe("ambiguity reports nothing rather than the wrong face", () => {
  test("two people sending identical text leaves both turns unattributed", () => {
    regularSession("sess-1");
    recordAuthoredSend({ sessionId: "sess-1", participantId: ownerId(), text: "yes" });
    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "yes" });

    expect(authoredSendParticipantId("sess-1", "yes")).toBeNull();
    expect(messageAuthorForSession("sess-1", { role: "user", text: "yes" }).verified).toBe(false);
  });

  test("one person repeating themselves stays attributed", () => {
    regularSession("sess-1");
    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "yes" });
    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "yes" });

    expect(authoredSendParticipantId("sess-1", "yes")).toBe(guestId());
  });

  test("a later unambiguous message from either person is unaffected", () => {
    regularSession("sess-1");
    recordAuthoredSend({ sessionId: "sess-1", participantId: ownerId(), text: "yes" });
    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "yes" });
    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "and rebase please" });

    expect(messageAuthorForSession("sess-1", { role: "user", text: "and rebase please" })).toEqual({
      kind: "human",
      participantId: guestId(),
      verified: true,
    });
  });
});

describe("the existing bot path is unchanged", () => {
  test("an in-text marker still wins over a side-store entry for the same text", () => {
    regularSession("sess-1");
    const text = `${formatBotAttribution(OWNER, "Scout")}\n\nlook into this`;
    // A side-store entry naming somebody else must not override the marker
    // the bot path treats as authoritative.
    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text });

    expect(messageAuthorForSession("sess-1", { role: "user", text })).toEqual({
      kind: "human",
      participantId: ownerId(),
      verified: true,
    });
  });

  test("a session with no conversation record is still unknown", () => {
    recordAuthoredSend({ sessionId: "ghost", participantId: guestId(), text: "hello" });
    expect(messageAuthorForSession("ghost", { role: "user", text: "hello" }).verified).toBe(false);
  });
});

describe("only a verified identity may be recorded", () => {
  test("an empty participant id or empty text records nothing", () => {
    recordAuthoredSend({ sessionId: "sess-1", participantId: "", text: "hello" });
    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "   " });
    expect(authoredSendParticipantId("sess-1", "hello")).toBeNull();
  });

  test("deleting a session's data drops its attributions", () => {
    recordAuthoredSend({ sessionId: "sess-1", participantId: guestId(), text: "hello" });
    forgetAuthoredSends("sess-1");
    expect(authoredSendParticipantId("sess-1", "hello")).toBeNull();
  });
});

describe("join on write drives the header roster and the solo rule", () => {
  test("a solo session keeps exactly one participant, so the row stays hidden", () => {
    regularSession("sess-1");
    expect(conversationForSession("sess-1")?.participants).toHaveLength(1);
  });

  test("a second human sending makes it two, which is what un-hides the row", () => {
    regularSession("sess-1");
    ensureConversationHuman({
      conversationId: "sess-1",
      identity: GUEST,
      name: "Guest",
      avatar: "/api/avatars/guest.png",
    });

    const participants = conversationForSession("sess-1")?.participants ?? [];
    expect(participants).toHaveLength(2);
    expect(participants.map((row) => row.id)).toEqual([ownerId(), guestId()]);
    // The creator keeps ownership; the joiner is a member.
    expect(participants[0]?.role).toBe("owner");
    expect(participants[1]?.role).toBe("member");
    // And the joiner arrives with a face to draw.
    expect(participants[1]?.display.avatar).toBe("/api/avatars/guest.png");
  });

  test("the creator sending again does not duplicate them into a second seat", () => {
    regularSession("sess-1");
    ensureConversationHuman({ conversationId: "sess-1", identity: OWNER, name: "Benny" });
    expect(conversationForSession("sess-1")?.participants).toHaveLength(1);
  });

  test("an untagged session that one person writes to gains its first participant", () => {
    regularSession("sess-3", null);
    expect(conversationForSession("sess-3")?.participants).toHaveLength(0);
    // No explicit role, matching the send handler: the first human in an
    // empty roster is seated as the owner.
    ensureConversationHuman({ conversationId: "sess-3", identity: GUEST, name: "Guest" });
    // First human in an empty roster becomes the owner, and one face is still
    // below the row's threshold, so a solo session shows nothing.
    const participants = conversationForSession("sess-3")?.participants ?? [];
    expect(participants).toHaveLength(1);
    expect(participants[0]?.role).toBe("owner");
  });
});

describe("end to end: a normal session's stored turn carries a verified author", () => {
  // This is what actually decides whether a face is drawn beside a message.
  // The transcript index recomputes the author from { role, text } on every
  // pass, so the whole feature depends on that recomputation finding the side
  // store — not on anything held in memory at send time.
  function msg(id: string, role: string, text: string): SessionMsg {
    return { id, role, kind: "text", text, ts: Date.now() };
  }

  test("the guest's turn is attributed and the agent's reply is not mistaken for a human", async () => {
    regularSession("sess-e2e");
    recordAuthoredSend({
      sessionId: "sess-e2e",
      participantId: guestId(),
      text: "please rerun the suite",
    });

    indexSessionMessagesDirect("sess-e2e", [
      msg("u1", "user", "please rerun the suite"),
      msg("a1", "assistant", "running it now"),
    ]);

    const page = await indexedMessagePage("lfg://session/sess-e2e", "sess-e2e");
    const user = page.messages.find((row) => row.role === "user");
    const assistant = page.messages.find((row) => row.role === "assistant");

    // The turn the client renders carries the sender, so OtherHumanMessageBubble
    // can resolve them against the roster and draw their avatar.
    expect(user?.author).toEqual({
      kind: "human",
      participantId: guestId(),
      verified: true,
    });
    // A coding agent is not a conversation participant, so its reply must stay
    // unattributed rather than borrowing the human's identity.
    expect(assistant?.author?.verified).toBe(false);
  });

  test("an unattributed turn in the same session stays unverified beside an attributed one", async () => {
    regularSession("sess-e2e2");
    recordAuthoredSend({ sessionId: "sess-e2e2", participantId: guestId(), text: "mine" });

    indexSessionMessagesDirect("sess-e2e2", [
      msg("u1", "user", "mine"),
      msg("u2", "user", "typed straight into the terminal"),
    ]);

    const page = await indexedMessagePage("lfg://session/sess-e2e2", "sess-e2e2");
    const byText = new Map(page.messages.map((row) => [row.text, row.author]));
    expect(byText.get("mine")?.verified).toBe(true);
    expect(byText.get("typed straight into the terminal")?.verified).toBe(false);
  });
});
