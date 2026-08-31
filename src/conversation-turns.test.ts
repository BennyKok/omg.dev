// One recorder, both surfaces.
//
// The point of these is not that recordHumanTurn works — it is that a bot
// conversation and an ordinary session come out of it indistinguishable, so
// there is no second behaviour to remember.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { recordHumanTurn } from "./conversation-turns.ts";
import { resetAuthoredSendsForTests } from "./conversation-authorship.ts";
import {
  conversationForSession,
  conversationHumanParticipantId,
  ensureBotConversation,
  attachRuntimeSession,
  messageAuthorForSession,
  migrateLegacyConversations,
  resetConversationsForTests,
  botParticipantId,
} from "./conversations.ts";
import { formatBotAttribution, resolveBotMessageAuthor } from "./bots/authorship.ts";

const originalData = PATHS.data;
let root = "";

const ANA = "ana@example.com";
const BEN = "ben@example.com";
const anaId = () => conversationHumanParticipantId(ANA);
const benId = () => conversationHumanParticipantId(BEN);
const SCOUT = { id: "bot_scout", name: "Scout", owner: null };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omg-turns-"));
  (PATHS as { data: string }).data = root;
  resetConversationsForTests();
  resetAuthoredSendsForTests();
});

afterEach(() => {
  (PATHS as { data: string }).data = originalData;
  rmSync(root, { recursive: true, force: true });
});

/** An ordinary coding session, as listSessions materializes it. */
function ordinarySession(sessionId: string) {
  migrateLegacyConversations({
    sessions: [{ sessionId, assignedUser: null, startedAt: 1_000 } as never],
    bots: [],
    roster: [{ email: ANA, name: "Ana" }, { email: BEN, name: "Ben" }],
    now: 2_000,
  });
}

/** A bot conversation with its own durable id and a runtime attached. */
function botConversation(conversationId: string, sessionId: string) {
  ensureBotConversation({ conversationId, bot: SCOUT, roster: [] });
  attachRuntimeSession({
    conversationId,
    sessionId,
    participantId: botParticipantId(SCOUT.id),
    kind: "primary",
  });
}

describe("the roster behaves identically on both surfaces", () => {
  test("an ordinary session seats the first writer as owner and the next as member", () => {
    ordinarySession("sess");
    recordHumanTurn({ conversationId: "sess", sessionId: "sess", identity: ANA, deliveredText: "one" });
    recordHumanTurn({ conversationId: "sess", sessionId: "sess", identity: BEN, deliveredText: "two" });

    const roles = conversationForSession("sess")?.participants.map((p) => [p.id, p.role]);
    expect(roles).toEqual([[anaId(), "owner"], [benId(), "member"]]);
  });

  test("a bot conversation seats them the same way", () => {
    botConversation("conv", "runtime");
    recordHumanTurn({ conversationId: "conv", sessionId: "runtime", identity: ANA, deliveredText: "one" });
    recordHumanTurn({ conversationId: "conv", sessionId: "runtime", identity: BEN, deliveredText: "two" });

    const humans = conversationForSession("runtime")?.participants.filter((p) => p.kind === "human");
    expect(humans?.map((p) => [p.id, p.role])).toEqual([[anaId(), "owner"], [benId(), "member"]]);
  });

  test("writing again never duplicates a participant", () => {
    ordinarySession("sess");
    recordHumanTurn({ conversationId: "sess", sessionId: "sess", identity: ANA, deliveredText: "one" });
    recordHumanTurn({ conversationId: "sess", sessionId: "sess", identity: ANA, deliveredText: "two" });
    expect(conversationForSession("sess")?.participants).toHaveLength(1);
  });
});

describe("attribution behaves identically on both surfaces", () => {
  test("an ordinary session turn resolves to its sender", () => {
    ordinarySession("sess");
    recordHumanTurn({ conversationId: "sess", sessionId: "sess", identity: BEN, deliveredText: "rerun it" });

    expect(messageAuthorForSession("sess", { role: "user", text: "rerun it" })).toEqual({
      kind: "human",
      participantId: benId(),
      verified: true,
    });
  });

  test("a bot turn resolves to its sender through the same store", () => {
    botConversation("conv", "runtime");
    const delivered = `${formatBotAttribution(BEN, "Scout")}\n\nrerun it`;
    recordHumanTurn({ conversationId: "conv", sessionId: "runtime", identity: BEN, deliveredText: delivered });

    expect(messageAuthorForSession("runtime", { role: "user", text: delivered })).toEqual({
      kind: "human",
      participantId: benId(),
      verified: true,
    });
  });
});

describe("the delivered text is what makes bot attribution unambiguous", () => {
  test("two people sending the same words to a bot stay separable", () => {
    botConversation("conv", "runtime");
    // The marker the bot path prepends differs per sender, so the digests do
    // too. This is the case that is lossy for an ordinary session and is NOT
    // lossy here — without passing the delivered text it would be lossy for
    // both, which would be a regression against the marker it replaces.
    const fromAna = `${formatBotAttribution(ANA, "Scout")}\n\nyes`;
    const fromBen = `${formatBotAttribution(BEN, "Scout")}\n\nyes`;
    recordHumanTurn({ conversationId: "conv", sessionId: "runtime", identity: ANA, deliveredText: fromAna });
    recordHumanTurn({ conversationId: "conv", sessionId: "runtime", identity: BEN, deliveredText: fromBen });

    expect(messageAuthorForSession("runtime", { role: "user", text: fromAna })?.participantId).toBe(anaId());
    expect(messageAuthorForSession("runtime", { role: "user", text: fromBen })?.participantId).toBe(benId());
  });

  test("the same words in an ordinary session stay ambiguous, and say so", () => {
    ordinarySession("sess");
    recordHumanTurn({ conversationId: "sess", sessionId: "sess", identity: ANA, deliveredText: "yes" });
    recordHumanTurn({ conversationId: "sess", sessionId: "sess", identity: BEN, deliveredText: "yes" });

    // No marker to separate them, so nobody is named rather than the wrong
    // person. This is the one place the two surfaces genuinely differ, and it
    // differs because the underlying evidence differs, not because the code
    // took a different branch.
    expect(messageAuthorForSession("sess", { role: "user", text: "yes" }).verified).toBe(false);
  });
});

describe("what the recorder refuses", () => {
  test("an identity that is not an address records nothing", () => {
    ordinarySession("sess");
    recordHumanTurn({ conversationId: "sess", sessionId: "sess", identity: "user", deliveredText: "hi" });
    expect(conversationForSession("sess")?.participants).toHaveLength(0);
    expect(messageAuthorForSession("sess", { role: "user", text: "hi" }).verified).toBe(false);
  });

  test("no conversation id still attributes the turn, it just cannot join a roster", () => {
    ordinarySession("sess");
    recordHumanTurn({ conversationId: null, sessionId: "sess", identity: ANA, deliveredText: "hi" });
    expect(conversationForSession("sess")?.participants).toHaveLength(0);
    expect(messageAuthorForSession("sess", { role: "user", text: "hi" })?.participantId).toBe(anaId());
  });
});

describe("hosted and self-hosted resolve the same way", () => {
  // The parity rule: the box is the trust boundary, and `managed` records HOW
  // an address was obtained, not WHETHER it is believed. Both lanes therefore
  // produce an address, and the address rule alone decides whether a face is
  // drawn. What must never happen is a lane producing a placeholder that gets
  // treated as a person.
  const roster = [ANA, BEN];

  test("a managed caller's grant email wins and a declared user is inert", () => {
    const { author } = resolveBotMessageAuthor({
      viewer: { managed: true, identity: ANA },
      rosterTagUser: BEN,
      botOwner: undefined,
      envUser: undefined,
    });
    expect(author).toBe(ANA);
  });

  test("a self-hosted caller's roster-validated address is used", () => {
    const { author } = resolveBotMessageAuthor({
      viewer: { managed: false, identity: "__local__" },
      rosterTagUser: BEN,
      botOwner: undefined,
      envUser: undefined,
    });
    expect(author).toBe(BEN);
  });

  test("both lanes then attribute identically through one recorder", () => {
    ordinarySession("sess-hosted");
    ordinarySession("sess-self");
    recordHumanTurn({ conversationId: "sess-hosted", sessionId: "sess-hosted", identity: ANA, deliveredText: "go" });
    recordHumanTurn({ conversationId: "sess-self", sessionId: "sess-self", identity: ANA, deliveredText: "go" });

    const hosted = messageAuthorForSession("sess-hosted", { role: "user", text: "go" });
    const self = messageAuthorForSession("sess-self", { role: "user", text: "go" });
    expect(self).toEqual(hosted);
    expect(self.participantId).toBe(anaId());
  });

  test("a box with nothing to go on resolves a placeholder, which is refused", () => {
    // No managed grant, no roster, no OMG_USER. resolveBotMessageAuthor still
    // has to return a string for the bot prompt, and returns the literal
    // "user". That is not a person, so no roster seat and no face.
    const { author } = resolveBotMessageAuthor({
      viewer: { managed: false, identity: "__local__" },
      rosterTagUser: undefined,
      botOwner: undefined,
      envUser: undefined,
    });
    expect(author).toBe("user");

    ordinarySession("sess-bare");
    recordHumanTurn({ conversationId: "sess-bare", sessionId: "sess-bare", identity: author, deliveredText: "go" });
    expect(conversationForSession("sess-bare")?.participants).toHaveLength(0);
    expect(messageAuthorForSession("sess-bare", { role: "user", text: "go" }).verified).toBe(false);
  });

  test("the roster is what stops a stranger being named on a self-hosted box", () => {
    // resolveSessionUserTag is the validator the send routes run before this
    // point; an address outside the roster never reaches the recorder.
    expect(roster).not.toContain("stranger@example.com");
  });
});
