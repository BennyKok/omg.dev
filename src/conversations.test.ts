import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  attachRuntimeSession,
  botParticipantId,
  canManageConversation,
  canReadConversation,
  canWriteConversation,
  conversationBotParticipant,
  conversationHumanParticipantId,
  detachRuntimeSession,
  ensureBotConversation,
  ensureConversationHuman,
  getConversation,
  leaveConversationParticipant,
  listConversations,
  messageAuthorForSession,
  migrateLegacyConversations,
  replaceConversationPrimaryRuntime,
  upsertConversationParticipant,
  viewerConversationParticipantId,
} from "./conversations.ts";
import { formatBotAttribution } from "./bots/authorship.ts";
import {
  indexedMessagePage,
  indexedMessagesAfterRowid,
  indexSessionMessagesDirect,
  resetTranscriptIndexConnectionForTests,
} from "./transcript-index.ts";
import type { SessionMsg } from "./sessions.ts";

const originalData = PATHS.data;
let root = "";

const scout = { id: "bot_scout", name: "Scout", owner: "owner@example.com", sessionId: "conversation-1" };
const analyst = { id: "bot_analyst", name: "Analyst" };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omg-conversation-"));
  PATHS.data = root;
  resetTranscriptIndexConnectionForTests();
});

afterEach(() => {
  resetTranscriptIndexConnectionForTests();
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

describe("conversation migration and identity", () => {
  test("rotation replaces only the primary runtime and keeps participants and children", () => {
    ensureBotConversation({
      conversationId: "conversation-1",
      bot: scout,
      ownerIdentity: scout.owner,
      roster: [{ email: scout.owner!, name: "Owner" }],
      now: 10,
    });
    attachRuntimeSession({
      conversationId: "conversation-1",
      sessionId: "runtime-old",
      participantId: botParticipantId(scout.id),
      kind: "primary",
      attachedAt: 11,
    });
    attachRuntimeSession({
      conversationId: "conversation-1",
      sessionId: "child-active",
      participantId: botParticipantId(scout.id),
      kind: "execution",
      attachedAt: 12,
    });

    const before = getConversation("conversation-1")!;
    const participantIds = before.participants.map((row) => row.id);
    replaceConversationPrimaryRuntime({
      conversationId: "conversation-1",
      sessionId: "runtime-new",
      participantId: botParticipantId(scout.id),
      attachedAt: 20,
      now: 21,
    });

    const after = getConversation("conversation-1")!;
    expect(after.id).toBe("conversation-1");
    expect(after.participants.map((row) => row.id)).toEqual(participantIds);
    expect(after.runtimeSessions.find((row) => row.sessionId === "runtime-old")?.detachedAt).toBe(21);
    expect(after.runtimeSessions.find((row) => row.sessionId === "runtime-new")).toMatchObject({
      kind: "primary",
      participantId: botParticipantId(scout.id),
    });
    const child = after.runtimeSessions.find((row) => row.sessionId === "child-active");
    expect(child?.kind).toBe("execution");
    expect(child?.detachedAt).toBeUndefined();
    expect(after.runtimeSessions.filter((row) => row.kind === "primary" && !row.detachedAt)).toHaveLength(1);

    // A failed commit can restore the old primary without changing the roster.
    replaceConversationPrimaryRuntime({
      conversationId: "conversation-1",
      sessionId: "runtime-old",
      participantId: botParticipantId(scout.id),
      now: 30,
    });
    detachRuntimeSession("conversation-1", "runtime-new", 30);
    const rolledBack = getConversation("conversation-1")!;
    expect(rolledBack.runtimeSessions.find((row) => row.sessionId === "runtime-old")?.detachedAt).toBeNull();
    expect(rolledBack.runtimeSessions.find((row) => row.sessionId === "runtime-new")?.detachedAt).toBe(30);
  });

  test("migrates Session.botId once and makes children execution attachments, not participants", () => {
    const rows = migrateLegacyConversations({
      now: 1_000,
      bots: [scout],
      roster: [{ email: "owner@example.com", name: "Owner", avatar: "/owner.png" }],
      sessions: [
        { sessionId: "conversation-1", botId: scout.id, assignedUser: scout.owner, startedAt: 100 },
        {
          sessionId: "child-1",
          botId: scout.id,
          parentSessionId: "conversation-1",
          spawnedBy: "subagent",
          startedAt: 200,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("conversation-1");
    expect(rows[0].participants.map((row) => row.id)).toEqual([
      conversationHumanParticipantId("owner@example.com"),
      botParticipantId(scout.id),
    ]);
    expect(rows[0].runtimeSessions).toEqual([
      expect.objectContaining({ sessionId: "conversation-1", kind: "primary" }),
      expect.objectContaining({ sessionId: "child-1", kind: "execution" }),
    ]);
    expect(rows[0].participants.some((row) => row.id === "child-1")).toBe(false);

    // A reload repeats the migration without duplicating durable state.
    expect(migrateLegacyConversations({ bots: [scout], sessions: [] })).toEqual(rows);
    expect(listConversations()).toHaveLength(1);
  });

  test("runtime rotation retains conversation identity, participants, and attachment history", () => {
    ensureBotConversation({ conversationId: "conversation-1", bot: scout });
    attachRuntimeSession({
      conversationId: "conversation-1",
      sessionId: "runtime-old",
      participantId: botParticipantId(scout.id),
      kind: "primary",
      attachedAt: 10,
    });
    attachRuntimeSession({
      conversationId: "conversation-1",
      sessionId: "runtime-new",
      participantId: botParticipantId(scout.id),
      kind: "primary",
      attachedAt: 20,
    });
    migrateLegacyConversations({
      bots: [scout],
      sessions: [
        {
          sessionId: "runtime-rotated",
          conversationId: "conversation-1",
          botId: scout.id,
          startedAt: 30,
        },
      ],
    });
    const conversation = getConversation("conversation-1")!;
    expect(conversation.id).toBe("conversation-1");
    expect(conversation.runtimeSessions.map((row) => row.sessionId)).toEqual([
      "runtime-old",
      "runtime-new",
      "runtime-rotated",
    ]);
    expect(conversation.participants.map((row) => row.id)).toEqual([
      conversationHumanParticipantId("owner@example.com"),
      botParticipantId(scout.id),
    ]);
  });

  test("a stale saved bot session cannot claim another conversation", () => {
    const rows = migrateLegacyConversations({
      bots: [scout],
      sessions: [
        { sessionId: "conversation-1", assignedUser: "someone@example.com" },
        { sessionId: "scout-real", botId: scout.id, assignedUser: scout.owner },
      ],
    });
    const conversation = rows.find((row) =>
      row.participants.some((participant) => participant.id === botParticipantId(scout.id)),
    );
    expect(conversation?.id).toBe("scout-real");
    expect(conversation?.runtimeSessions.map((row) => row.sessionId)).toEqual(["scout-real"]);
  });

  test("supports two real bot participants with leave and history semantics", () => {
    ensureBotConversation({ conversationId: "conversation-1", bot: scout });
    upsertConversationParticipant(
      "conversation-1",
      conversationBotParticipant(analyst, { historyAccess: "from_join", joinedAt: 500 }),
    );
    const analystId = botParticipantId(analyst.id);
    const joined = getConversation("conversation-1")!;
    expect(joined.participants.filter((row) => row.kind === "bot")).toHaveLength(2);
    expect(canReadConversation(joined, analystId, 499)).toBe(false);
    expect(canReadConversation(joined, analystId, 500)).toBe(true);
    expect(canWriteConversation(joined, analystId)).toBe(true);
    leaveConversationParticipant("conversation-1", analystId, 700);
    const left = getConversation("conversation-1")!;
    expect(canReadConversation(left, analystId, 650)).toBe(true);
    expect(canReadConversation(left, analystId, 701)).toBe(false);
    expect(canWriteConversation(left, analystId)).toBe(false);
  });

  test("a verified human must be on the roster before access is granted", () => {
    ensureBotConversation({ conversationId: "conversation-1", bot: scout });
    const memberId = conversationHumanParticipantId("member@example.com");
    expect(canReadConversation(getConversation("conversation-1")!, memberId)).toBe(false);
    ensureConversationHuman({
      conversationId: "conversation-1",
      identity: "member@example.com",
      name: "Member",
      role: "observer",
      historyAccess: "from_join",
      joinedAt: 900,
    });
    const conversation = getConversation("conversation-1")!;
    expect(canReadConversation(conversation, memberId, 899)).toBe(false);
    expect(canReadConversation(conversation, memberId, 901)).toBe(true);
    expect(canWriteConversation(conversation, memberId)).toBe(false);
    expect(canManageConversation(conversation, memberId)).toBe(false);
    expect(canManageConversation(
      conversation,
      conversationHumanParticipantId("owner@example.com"),
    )).toBe(true);
  });
});

describe("persisted message authors", () => {
  const humanText = `${formatBotAttribution("member@example.com", "Scout")}\n\nhello`;

  function message(id: string, role: string, text: string): SessionMsg {
    return { id, role, kind: "text", text, ts: Date.now() };
  }

  test("resolves only server-authored human markers and attached bot runtimes", () => {
    ensureBotConversation({ conversationId: "conversation-1", bot: scout });
    attachRuntimeSession({
      conversationId: "conversation-1",
      sessionId: "runtime-1",
      participantId: botParticipantId(scout.id),
      kind: "primary",
    });
    expect(messageAuthorForSession("runtime-1", message("u", "user", humanText))).toEqual({
      kind: "human",
      participantId: conversationHumanParticipantId("member@example.com"),
      verified: true,
    });
    expect(messageAuthorForSession("runtime-1", message("a", "assistant", "hello"))).toEqual({
      kind: "bot",
      participantId: botParticipantId(scout.id),
      verified: true,
    });
    expect(messageAuthorForSession("runtime-1", message("old", "user", "plain old message"))).toEqual({
      kind: "legacy",
      participantId: "legacy:unknown",
      verified: false,
    });
  });

  test("pagination and live-row reads return the same durable author references", async () => {
    ensureBotConversation({ conversationId: "conversation-1", bot: scout });
    attachRuntimeSession({
      conversationId: "conversation-1",
      sessionId: "runtime-1",
      participantId: botParticipantId(scout.id),
      kind: "primary",
    });
    indexSessionMessagesDirect("runtime-1", [
      message("u", "user", humanText),
      message("a", "assistant", "answer"),
    ]);
    const page = await indexedMessagePage("lfg://session/runtime-1", "runtime-1", { limit: 1 });
    expect(page.messages[0].author).toEqual({
      kind: "bot",
      participantId: botParticipantId(scout.id),
      verified: true,
    });
    expect(page.nextBefore).not.toBeNull();
    const live = indexedMessagesAfterRowid("lfg://session/runtime-1", "runtime-1", 0);
    expect(live.messages.map((row) => row.author)).toEqual([
      {
        kind: "human",
        participantId: conversationHumanParticipantId("member@example.com"),
        verified: true,
      },
      {
        kind: "bot",
        participantId: botParticipantId(scout.id),
        verified: true,
      },
    ]);
  });

  test("an authorless row stays explicit legacy unknown after the roster appears", async () => {
    indexSessionMessagesDirect("runtime-legacy", [message("old", "user", "historical")]);
    ensureBotConversation({ conversationId: "conversation-legacy", bot: scout });
    attachRuntimeSession({
      conversationId: "conversation-legacy",
      sessionId: "runtime-legacy",
      participantId: botParticipantId(scout.id),
      kind: "primary",
    });
    const page = await indexedMessagePage("lfg://session/runtime-legacy", "runtime-legacy");
    expect(page.messages[0].author).toEqual({
      kind: "legacy",
      participantId: "legacy:unknown",
      verified: false,
    });
  });
});

describe("the bootstrap viewer identity", () => {
  // What GET /api/bootstrap stamps as `viewer.participantId` — the id the UI
  // compares each verified human MessageAuthorRef against to decide "is this
  // my own turn" (see isOtherHumanMessageAuthor on the client). It must agree
  // with the id a verified human turn actually resolves to, or a shared bot
  // conversation would draw a redundant avatar on the viewer's own messages,
  // or (worse) skip drawing one on someone else's.
  test("resolves the same id a verified human turn resolves to", () => {
    expect(viewerConversationParticipantId("member@example.com")).toBe(
      conversationHumanParticipantId("member@example.com"),
    );
  });

  test("is case/whitespace-insensitive, matching the access boundary", () => {
    expect(viewerConversationParticipantId("  MEMBER@Example.com ")).toBe(
      conversationHumanParticipantId("member@example.com"),
    );
  });

  test("a non-email placeholder resolves to null, not a hash of the placeholder", () => {
    // botViewer's unmanaged-with-nothing-selected fallback is a fixed
    // sentinel string ("__local__"), never an address. Hashing it would
    // produce a stable id that happens to name nobody real — worse than null,
    // because a caller could mistake it for a resolved identity.
    expect(viewerConversationParticipantId("__local__")).toBeNull();
    expect(viewerConversationParticipantId("")).toBeNull();
  });

  test("two different local placeholders never collide with each other or a real member", () => {
    const real = viewerConversationParticipantId("member@example.com");
    expect(viewerConversationParticipantId("__local__")).not.toBe(real);
    expect(viewerConversationParticipantId("also-not-an-email")).toBeNull();
  });
});
