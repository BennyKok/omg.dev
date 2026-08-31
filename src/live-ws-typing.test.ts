// Typing presence on the live websocket.
//
// The two properties worth pinning are the ones that go wrong quietly:
// a socket must never be able to claim somebody else's identity, and a
// presence frame must never be replayed from the resume ring (a stale "still
// typing" has no later frame to correct it, because the truth is an absence
// of frames).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerWebSocket } from "bun";
import { PATHS } from "./config.ts";
import { createLiveWsSupport } from "./live-ws.ts";
import {
  attachRuntimeSession,
  botParticipantId,
  ensureBotConversation,
  replaceConversationPrimaryRuntime,
  resetConversationsForTests,
} from "./conversations.ts";

const SID = "11111111-1111-4111-8111-111111111111";
const OTHER_SID = "22222222-2222-4222-8222-222222222222";
const ANA = "human:aaaaaaaaaaaaaaaa";
const BEN = "human:bbbbbbbbbbbbbbbb";

type Frame = Record<string, unknown>;
type Fake = ServerWebSocket<unknown> & { frames: Frame[] };

let live: ReturnType<typeof createLiveWsSupport> | null = null;
const opened: Fake[] = [];
const originalData = PATHS.data;
let root = "";

// Isolate the conversation store: presence resolves a session's durable
// conversation through it, and reading the developer's real store would let
// unrelated rows decide these assertions.
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omg-typing-"));
  (PATHS as { data: string }).data = root;
  resetConversationsForTests();
});

function support() {
  live ??= createLiveWsSupport({ evlog: () => {} });
  return live;
}

function socket(participantId: string | null): Fake {
  const frames: Frame[] = [];
  const ws = {
    frames,
    data: support().dataForRequest(participantId),
    send(raw: string) {
      frames.push(JSON.parse(raw) as Frame);
    },
    close() {},
  } as unknown as Fake;
  support().open(ws);
  opened.push(ws);
  return ws;
}

function send(ws: Fake, payload: unknown) {
  support().message(ws, JSON.stringify(payload));
}

/** Subscribe and let the async transcript work settle, then drop the noise. */
async function subscribe(ws: Fake, sid: string) {
  send(ws, { t: "subscribe", ids: [sid] });
  await new Promise((resolve) => setTimeout(resolve, 10));
  ws.frames.length = 0;
}

const typingFrames = (ws: Fake) => ws.frames.filter((frame) => frame.t === "typing");
const lastTypingIds = (ws: Fake) => {
  const rows = typingFrames(ws);
  return rows.length ? (rows[rows.length - 1]!.ids as string[]) : null;
};

afterEach(() => {
  for (const ws of opened.splice(0)) support().close(ws);
  live = null;
  (PATHS as { data: string }).data = originalData;
  rmSync(root, { recursive: true, force: true });
});

describe("only a verified socket identity can claim to be typing", () => {
  test("a socket with no resolved participant is inert", async () => {
    const anon = socket(null);
    const watcher = socket(BEN);
    await subscribe(anon, SID);
    await subscribe(watcher, SID);

    send(anon, { t: "typing", sid: SID, typing: true });
    expect(typingFrames(watcher)).toHaveLength(0);
  });

  test("the frame carries no author field, so a client cannot nominate one", async () => {
    const ana = socket(ANA);
    const watcher = socket(BEN);
    await subscribe(ana, SID);
    await subscribe(watcher, SID);

    // A hostile client tries to type as somebody else. The extra fields are
    // ignored entirely: the identity comes from the upgrade, not the frame.
    send(ana, { t: "typing", sid: SID, typing: true, participantId: BEN, ids: [BEN] });
    expect(lastTypingIds(watcher)).toEqual([ANA]);
  });

  test("a socket cannot claim typing in a session it never subscribed to", async () => {
    const ana = socket(ANA);
    const watcher = socket(BEN);
    await subscribe(ana, OTHER_SID);
    await subscribe(watcher, SID);

    send(ana, { t: "typing", sid: SID, typing: true });
    expect(typingFrames(watcher)).toHaveLength(0);
  });

  test("a malformed session id is rejected rather than creating a bucket", async () => {
    const ana = socket(ANA);
    await subscribe(ana, SID);
    send(ana, { t: "typing", sid: "../etc", typing: true });
    expect(typingFrames(ana)).toHaveLength(0);
  });
});

describe("the wire shape is the full set, not join/leave events", () => {
  test("each frame carries everyone currently typing in that session", async () => {
    const ana = socket(ANA);
    const ben = socket(BEN);
    const watcher = socket(ANA);
    await subscribe(ana, SID);
    await subscribe(ben, SID);
    await subscribe(watcher, SID);

    send(ana, { t: "typing", sid: SID, typing: true });
    expect(lastTypingIds(watcher)).toEqual([ANA]);

    send(ben, { t: "typing", sid: SID, typing: true });
    expect(lastTypingIds(watcher)).toEqual([ANA, BEN]);

    send(ana, { t: "typing", sid: SID, typing: false });
    expect(lastTypingIds(watcher)).toEqual([BEN]);
  });

  test("presence does not leak into another session", async () => {
    const ana = socket(ANA);
    const elsewhere = socket(BEN);
    await subscribe(ana, SID);
    await subscribe(elsewhere, OTHER_SID);

    send(ana, { t: "typing", sid: SID, typing: true });
    expect(typingFrames(elsewhere)).toHaveLength(0);
  });

  test("a repeated heartbeat does not put a frame on the wire each time", async () => {
    const ana = socket(ANA);
    const watcher = socket(BEN);
    await subscribe(ana, SID);
    await subscribe(watcher, SID);

    send(ana, { t: "typing", sid: SID, typing: true });
    send(ana, { t: "typing", sid: SID, typing: true });
    send(ana, { t: "typing", sid: SID, typing: true });
    // One membership change, therefore exactly one broadcast. Otherwise every
    // keystroke heartbeat fans out to every subscribed socket.
    expect(typingFrames(watcher)).toHaveLength(1);
  });

  test("a redundant stop from someone who was not typing is silent", async () => {
    const ana = socket(ANA);
    const watcher = socket(BEN);
    await subscribe(ana, SID);
    await subscribe(watcher, SID);

    send(ana, { t: "typing", sid: SID, typing: false });
    expect(typingFrames(watcher)).toHaveLength(0);
  });
});

describe("one person with two tabs is one typist", () => {
  test("blurring one tab does not erase the other tab's live keystrokes", async () => {
    const tabOne = socket(ANA);
    const tabTwo = socket(ANA);
    const watcher = socket(BEN);
    await subscribe(tabOne, SID);
    await subscribe(tabTwo, SID);
    await subscribe(watcher, SID);

    send(tabOne, { t: "typing", sid: SID, typing: true });
    send(tabTwo, { t: "typing", sid: SID, typing: true });
    expect(lastTypingIds(watcher)).toEqual([ANA]);

    // Tab two blurs. Tab one is still being typed in.
    send(tabTwo, { t: "typing", sid: SID, typing: false });
    expect(lastTypingIds(watcher)).toEqual([ANA]);

    send(tabOne, { t: "typing", sid: SID, typing: false });
    expect(lastTypingIds(watcher)).toEqual([]);
  });

  test("the second tab joining does not re-broadcast an unchanged set", async () => {
    const tabOne = socket(ANA);
    const tabTwo = socket(ANA);
    const watcher = socket(BEN);
    await subscribe(tabOne, SID);
    await subscribe(tabTwo, SID);
    await subscribe(watcher, SID);

    send(tabOne, { t: "typing", sid: SID, typing: true });
    send(tabTwo, { t: "typing", sid: SID, typing: true });
    expect(typingFrames(watcher)).toHaveLength(1);
  });
});

describe("a dropped socket cannot leave a stuck indicator", () => {
  test("closing retracts that socket's claim immediately", async () => {
    const ana = socket(ANA);
    const watcher = socket(BEN);
    await subscribe(ana, SID);
    await subscribe(watcher, SID);

    send(ana, { t: "typing", sid: SID, typing: true });
    expect(lastTypingIds(watcher)).toEqual([ANA]);

    support().close(ana);
    expect(lastTypingIds(watcher)).toEqual([]);
  });

  test("closing one of a person's two tabs keeps them typing", async () => {
    const tabOne = socket(ANA);
    const tabTwo = socket(ANA);
    const watcher = socket(BEN);
    await subscribe(tabOne, SID);
    await subscribe(tabTwo, SID);
    await subscribe(watcher, SID);

    send(tabOne, { t: "typing", sid: SID, typing: true });
    send(tabTwo, { t: "typing", sid: SID, typing: true });
    support().close(tabTwo);
    expect(lastTypingIds(watcher)).toEqual([ANA]);
  });
});

describe("presence is never replayed from the resume ring", () => {
  test("a typing frame is unstamped, so no client can resume into a stale one", async () => {
    const ana = socket(ANA);
    const watcher = socket(BEN);
    await subscribe(ana, SID);
    await subscribe(watcher, SID);

    send(ana, { t: "typing", sid: SID, typing: true });
    const frame = typingFrames(watcher)[0]!;
    // No seq and no channel envelope means publishChannelDelta never saw it,
    // which is the only thing that keeps it out of the ring.
    expect(frame.seq).toBeUndefined();
    expect(frame.kind).toBeUndefined();
    expect(frame.t).toBe("typing");
    expect(frame.sid).toBe(SID);
  });

  test("a socket subscribing later is told the current set once", async () => {
    const ana = socket(ANA);
    await subscribe(ana, SID);
    send(ana, { t: "typing", sid: SID, typing: true });

    const latecomer = socket(BEN);
    send(latecomer, { t: "subscribe", ids: [SID] });
    // Sent synchronously on subscribe, before any transcript IO settles.
    expect(lastTypingIds(latecomer)).toEqual([ANA]);
  });

  test("a reconnecting socket is told an empty set rather than being left stale", async () => {
    const latecomer = socket(BEN);
    send(latecomer, { t: "subscribe", ids: [SID] });
    // An empty set still has to arrive: it is what clears whatever the client
    // was drawing before it dropped.
    expect(lastTypingIds(latecomer)).toEqual([]);
  });
});

describe("presence follows the conversation, not the runtime session", () => {
  // A bot conversation's primary runtime id changes when the bot rotates, and
  // a conversation can hold several runtimes at once. Keying by sid dropped
  // everyone on a restart and hid two people looking at one conversation
  // through different runtimes.
  const SCOUT = { id: "bot_scout", name: "Scout", owner: null };
  const OLD_RUNTIME = "33333333-3333-4333-8333-333333333333";
  const NEW_RUNTIME = "44444444-4444-4444-8444-444444444444";

  function botConversation() {
    ensureBotConversation({ conversationId: "conv-1", bot: SCOUT, roster: [] });
    attachRuntimeSession({
      conversationId: "conv-1",
      sessionId: OLD_RUNTIME,
      participantId: botParticipantId(SCOUT.id),
      kind: "primary",
    });
  }

  test("two people on different runtimes of one conversation see each other", async () => {
    botConversation();
    attachRuntimeSession({
      conversationId: "conv-1",
      sessionId: NEW_RUNTIME,
      participantId: botParticipantId(SCOUT.id),
      kind: "primary",
    });

    const onOld = socket(ANA);
    const onNew = socket(BEN);
    await subscribe(onOld, OLD_RUNTIME);
    await subscribe(onNew, NEW_RUNTIME);

    send(onOld, { t: "typing", sid: OLD_RUNTIME, typing: true });

    // Addressed with the sid the watcher actually subscribed to, so its own
    // per-session state still keys correctly.
    const frame = typingFrames(onNew)[0];
    expect(frame?.sid).toBe(NEW_RUNTIME);
    expect(frame?.ids).toEqual([ANA]);
  });

  test("a claim survives the runtime being replaced under it", async () => {
    botConversation();
    const ana = socket(ANA);
    const watcher = socket(BEN);
    await subscribe(ana, OLD_RUNTIME);
    await subscribe(watcher, OLD_RUNTIME);
    send(ana, { t: "typing", sid: OLD_RUNTIME, typing: true });
    expect(lastTypingIds(watcher)).toEqual([ANA]);

    // The bot rotates. The claim is held against the conversation, so it is
    // still true, and a client arriving on the new runtime is told so.
    replaceConversationPrimaryRuntime({
      conversationId: "conv-1",
      sessionId: NEW_RUNTIME,
      participantId: botParticipantId(SCOUT.id),
    });

    const afterRotation = socket(BEN);
    send(afterRotation, { t: "subscribe", ids: [NEW_RUNTIME] });
    expect(lastTypingIds(afterRotation)).toEqual([ANA]);
  });

  test("a different conversation is still isolated", async () => {
    botConversation();
    const ana = socket(ANA);
    const elsewhere = socket(BEN);
    await subscribe(ana, OLD_RUNTIME);
    await subscribe(elsewhere, SID);

    send(ana, { t: "typing", sid: OLD_RUNTIME, typing: true });
    expect(typingFrames(elsewhere)).toHaveLength(0);
  });
});
