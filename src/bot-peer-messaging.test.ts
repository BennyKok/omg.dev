import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { createBot, updateBot, type Bot } from "./bots/store.ts";
import { resolveBotRuntimeActor, type BotRuntimeActor } from "./bots/self-management.ts";
import {
  BOT_PEER_MAX_DEPTH,
  BOT_PEER_MESSAGE_MAX_CHARS,
  BOT_PEER_RATE_LIMIT,
  BotPeerMessageError,
  formatBotPeerMessage,
  getBotPeerMessage,
  markBotPeerMessageEnqueued,
  reserveBotPeerMessage,
  resetBotPeerMessageStoreForTests,
} from "./bots/messaging.ts";
import {
  listQueue,
  recordCommandFileMessage,
  resetSendQueueForTests,
} from "./sendq.ts";

const originalData = PATHS.data;
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omg-bot-peer-"));
  PATHS.data = root;
  resetBotPeerMessageStoreForTests();
  resetSendQueueForTests();
});

afterEach(() => {
  resetBotPeerMessageStoreForTests();
  resetSendQueueForTests();
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

async function ownedPair(): Promise<{ a: Bot; b: Bot; actorA: BotRuntimeActor; actorB: BotRuntimeActor }> {
  const a = await createBot({
    name: "Planner",
    persona: "Private planner instructions",
    owner: "Owner@Example.com",
  });
  const b = await createBot({
    name: "Builder",
    persona: "Private builder instructions",
    owner: "owner@example.com",
  });
  const sessions = [
    { sessionId: "session-a", botId: a.id, assignedUser: "owner@example.com" },
    { sessionId: "session-b", botId: b.id, assignedUser: "owner@example.com" },
  ];
  return {
    a,
    b,
    actorA: resolveBotRuntimeActor("session-a", sessions, [a, b]),
    actorB: resolveBotRuntimeActor("session-b", sessions, [a, b]),
  };
}

function accept(message: { id: string }, index = 0) {
  return markBotPeerMessageEnqueued(message.id, "target-session", `queue-${index}`, 2_000 + index);
}

describe("persistent bot peer messaging", () => {
  test("derives stable attribution and persists a same-owner accepted message", async () => {
    const { a, b, actorA } = await ownedPair();
    const { message, target } = reserveBotPeerMessage({
      actor: actorA,
      bots: [a, b],
      targetBotId: b.id,
      text: "Please build release candidate 7.",
      now: 1_000,
    });
    const envelope = formatBotPeerMessage(message, actorA.bot, target);
    const accepted = accept(message);

    expect(accepted).toMatchObject({
      sourceBotId: a.id,
      targetBotId: b.id,
      owner: "owner@example.com",
      depth: 0,
      status: "enqueued",
      targetSessionId: "target-session",
      queueMessageId: "queue-0",
    });
    expect(envelope).toContain(`Peer message from Planner (${a.id}) to Builder (${b.id})`);
    expect(envelope).toContain(`Message ID: ${message.id}`);
    expect(envelope).not.toContain(a.persona);
    expect(envelope).not.toContain(b.persona);

    resetBotPeerMessageStoreForTests();
    expect(getBotPeerMessage(message.id)).toEqual(accepted);
  });

  test("rejects cross-owner, missing, disabled, self, and spoofed runtime identities", async () => {
    const { a, b, actorA } = await ownedPair();
    const other = await createBot({ name: "Other", persona: "secret", owner: "other@example.com" });
    const disabled = (await updateBot(b.id, { enabled: false }))!;

    for (const [targetBotId, message] of [
      [other.id, "not owned"],
      ["bot_missing", "not found"],
      [disabled.id, "disabled"],
      [a.id, "cannot message itself"],
    ] as const) {
      expect(() => reserveBotPeerMessage({
        actor: actorA,
        bots: [a, disabled, other],
        targetBotId,
        text: "hello",
      })).toThrow(message);
    }

    expect(() => resolveBotRuntimeActor("session-a", [{
      sessionId: "session-a",
      botId: a.id,
      assignedUser: "spoofed@example.com",
    }], [a])).toThrow("ownership does not match");
  });

  test("keeps durable target queue order across a process-store reset", async () => {
    const { a, b, actorA } = await ownedPair();
    const first = reserveBotPeerMessage({
      actor: actorA,
      bots: [a, b],
      targetBotId: b.id,
      text: "first",
      now: 1_000,
    }).message;
    const second = reserveBotPeerMessage({
      actor: actorA,
      bots: [a, b],
      targetBotId: b.id,
      text: "second",
      now: 1_001,
    }).message;
    const queuedFirst = recordCommandFileMessage("target-session", formatBotPeerMessage(first, a, b));
    const queuedSecond = recordCommandFileMessage("target-session", formatBotPeerMessage(second, a, b));
    expect(queuedSecond.createdAt).toBeGreaterThan(queuedFirst.createdAt);
    markBotPeerMessageEnqueued(first.id, "target-session", queuedFirst.id);
    markBotPeerMessageEnqueued(second.id, "target-session", queuedSecond.id);

    expect(listQueue("target-session").map((row) => row.text)).toEqual([
      expect.stringContaining("first"),
      expect.stringContaining("second"),
    ]);
    resetSendQueueForTests();
    expect(listQueue("target-session").map((row) => row.id)).toEqual([queuedFirst.id, queuedSecond.id]);
  });

  test("preserves reply correlation and enforces the explicit conversation depth", async () => {
    const { a, b, actorA, actorB } = await ownedPair();
    let current = accept(reserveBotPeerMessage({
      actor: actorA,
      bots: [a, b],
      targetBotId: b.id,
      text: "start",
      now: 1_000,
    }).message);
    const correlationId = current.correlationId;

    for (let depth = 1; depth <= BOT_PEER_MAX_DEPTH; depth++) {
      const fromA = depth % 2 === 0;
      const next = reserveBotPeerMessage({
        actor: fromA ? actorA : actorB,
        bots: [a, b],
        targetBotId: fromA ? b.id : a.id,
        text: `reply ${depth}`,
        replyToMessageId: current.id,
        now: 1_000 + depth,
      }).message;
      current = accept(next, depth);
      expect(current).toMatchObject({ correlationId, depth, replyToMessageId: expect.any(String) });
    }

    expect(() => reserveBotPeerMessage({
      actor: actorB,
      bots: [a, b],
      targetBotId: a.id,
      text: "one reply too far",
      replyToMessageId: current.id,
      now: 2_000,
    })).toThrow(`conversation depth limit reached (${BOT_PEER_MAX_DEPTH})`);
  });

  test("rejects oversized bodies and enforces a persistent per-source rate limit", async () => {
    const { a, b, actorA } = await ownedPair();
    expect(() => reserveBotPeerMessage({
      actor: actorA,
      bots: [a, b],
      targetBotId: b.id,
      text: "x".repeat(BOT_PEER_MESSAGE_MAX_CHARS + 1),
    })).toThrow(`${BOT_PEER_MESSAGE_MAX_CHARS} characters`);

    for (let i = 0; i < BOT_PEER_RATE_LIMIT; i++) {
      accept(reserveBotPeerMessage({
        actor: actorA,
        bots: [a, b],
        targetBotId: b.id,
        text: `message ${i}`,
        now: 10_000 + i,
      }).message, i);
    }
    resetBotPeerMessageStoreForTests();
    expect(() => reserveBotPeerMessage({
      actor: actorA,
      bots: [a, b],
      targetBotId: b.id,
      text: "spam",
      now: 10_500,
    })).toThrow(BotPeerMessageError);
    expect(() => reserveBotPeerMessage({
      actor: actorA,
      bots: [a, b],
      targetBotId: b.id,
      text: "spam",
      now: 10_500,
    })).toThrow(`${BOT_PEER_RATE_LIMIT} per minute`);
  });
});
