import { describe, expect, test } from "bun:test";
import {
  appendOmgTranscriptEvent,
  mergeHistoryPage,
  omgMessagesToUIMessages,
  omgRowKey,
  omgUIMessagesToMessages,
  type OmgChatMessage,
} from "./omg-chat-transport";

// One message keeps one row from the moment it is drawn: the key a row is
// rendered under is handed from the local row (your send, the live draft, the
// AI SDK's own copy of a streamed reply) to the server row that confirms it.
// Every change of key used to unmount the bubble and mount a new one, which
// re-estimated its height and moved the transcript. Measured on a phone
// viewport, a single send replaced the same content four times and, after the
// turn, drew the reply twice until a reload.

/** What AbstractChat holds for a reply this browser streamed: no server metadata. */
function sdkReply(id: string, text: string, opts: { streaming?: boolean; startedAt?: number } = {}): OmgChatMessage {
  return {
    id,
    role: "assistant",
    metadata: opts.startedAt ? { startedAt: opts.startedAt } : undefined,
    parts: [{ type: "text", text, state: opts.streaming ? "streaming" : "done" }],
  };
}

/** Your send, as the composer hands it to the AI SDK. */
function sdkSend(id: string, text: string, ts: number): OmgChatMessage {
  return {
    id,
    role: "user",
    metadata: { omgMessage: { role: "user", kind: "text", text, ts, pending: true } },
    parts: [{ type: "text", text }],
  };
}

function server(id: string, role: "user" | "assistant", text: string, ts: number): OmgChatMessage {
  return omgMessagesToUIMessages([{ id, role, kind: "text", text, ts }])[0]!;
}

const keys = (messages: OmgChatMessage[]) => omgUIMessagesToMessages(messages).map((row) => row.renderKey ?? row.id);
const texts = (messages: OmgChatMessage[]) => omgUIMessagesToMessages(messages).map((row) => row.text);

describe("a message keeps one row", () => {
  test("a streamed reply keeps its key when it finishes", () => {
    const streaming = omgUIMessagesToMessages([sdkReply("r1", "Clouds", { streaming: true })])[0]!;
    const done = omgUIMessagesToMessages([sdkReply("r1", "Clouds drift.")])[0]!;
    // The draft marker stays on the id (it means "still being written")...
    expect(streaming.id).toBe("draft-r1");
    // ...but the row is the same one.
    expect(streaming.renderKey).toBe("r1");
    expect(done.renderKey).toBe("r1");
  });

  test("the confirmed send keeps the bubble the composer drew", () => {
    const sent = [sdkSend("sdk-u1", "hello", 100)];
    const confirmed = appendOmgTranscriptEvent(sent, {
      type: "message",
      message: { id: "srv-u1", role: "user", kind: "text", text: "hello", ts: 101 },
    }, { streamActive: true });
    expect(confirmed.map((message) => message.id)).toEqual(["srv-u1"]);
    expect(keys(confirmed)).toEqual(["sdk-u1"]);
  });

  test("the history page after a turn settles this browser's copies into the server rows", () => {
    // The live state at the end of a turn: the confirmed send (still under the
    // composer's key) and the reply the AI SDK assembled from the stream.
    const live = [
      server("srv-u1", "user", "three lines about clouds", 100),
      sdkReply("sdk-r1", "Cirrus are thin.\nStratus are flat.", { startedAt: 101 }),
    ];
    live[0] = { ...live[0]!, metadata: { omgMessage: { ...live[0]!.metadata!.omgMessage!, renderKey: "sdk-u1" } } };

    const page = [
      server("srv-u1", "user", "three lines about clouds", 100),
      server("srv-r1", "assistant", "Cirrus are thin.\nStratus are flat.", 102),
    ];
    const merged = mergeHistoryPage(live, page, [], new Set(live.map((message) => message.id)));

    // One reply, not two, and both rows still drawn under their first keys.
    expect(texts(merged)).toEqual(["three lines about clouds", "Cirrus are thin.\nStratus are flat."]);
    expect(merged.map((message) => message.id)).toEqual(["srv-u1", "srv-r1"]);
    expect(keys(merged)).toEqual(["sdk-u1", "sdk-r1"]);
  });

  test("a pending send the page already has is settled the same way", () => {
    const live = [sdkSend("sdk-u1", "hello", 100)];
    const merged = mergeHistoryPage(live, [server("srv-u1", "user", "hello", 101)], [], new Set());
    expect(merged.map((message) => message.id)).toEqual(["srv-u1"]);
    expect(omgRowKey(merged[0]!)).toBe("sdk-u1");
  });

  test("a repeated message settles only the new row, not an older identical one", () => {
    const earlier = server("srv-old", "user", "again", 50);
    const live = [earlier, sdkSend("sdk-u2", "again", 100)];
    const page = [server("srv-old", "user", "again", 50), server("srv-new", "user", "again", 101)];
    const merged = mergeHistoryPage(live, page, [], new Set(["srv-old"]));
    expect(merged.map((message) => message.id)).toEqual(["srv-old", "srv-new"]);
    expect(keys(merged)).toEqual(["srv-old", "sdk-u2"]);
  });

  test("a reply the page does not have yet stays", () => {
    const live = [sdkReply("sdk-r1", "still being saved", { startedAt: 101 })];
    const merged = mergeHistoryPage(live, [server("srv-u1", "user", "hi", 100)], [], new Set());
    expect(texts(merged)).toEqual(["hi", "still being saved"]);
  });

  test("the passive draft of each turn is its own row", () => {
    const draft = (text: string, ts: number) =>
      ({ type: "ai_part", part: { type: "text-delta", id: "draft-s1", text, reset: true, ts } }) as const;
    let state = appendOmgTranscriptEvent([], draft("one", 10));
    state = appendOmgTranscriptEvent(state, {
      type: "message",
      message: { id: "srv-a1", role: "assistant", kind: "text", text: "one", ts: 11 },
    });
    state = appendOmgTranscriptEvent(state, draft("two", 20));
    const rows = keys(state);
    // The finished reply keeps its draft's key, and the next draft has a new one.
    expect(rows).toHaveLength(2);
    expect(new Set(rows).size).toBe(2);
    expect(texts(state)).toEqual(["one", "two"]);
  });
});

describe("a message sent while a reply runs stays after it", () => {
  test("after the server confirms it, while the reply is still streaming", () => {
    const state = [
      server("srv-u1", "user", "write a long list", 100),
      server("srv-u2", "user", "stop, say ok", 150),
      sdkReply("sdk-r1", "1. Apple", { streaming: true, startedAt: 110 }),
    ];
    expect(texts(state)).toEqual(["write a long list", "1. Apple", "stop, say ok"]);
  });

  test("after the reply has finished but before its server row arrived", () => {
    const state = [
      server("srv-u1", "user", "write a long list", 100),
      server("srv-u2", "user", "stop, say ok", 150),
      sdkReply("sdk-r1", "1. Apple\n2. Banana", { startedAt: 110 }),
    ];
    expect(texts(state)).toEqual(["write a long list", "1. Apple\n2. Banana", "stop, say ok"]);
  });

  test("the prompt that started the reply stays above it", () => {
    const state = [server("srv-u1", "user", "write a long list", 100), sdkReply("sdk-r1", "1. Apple", { startedAt: 110 })];
    expect(texts(state)).toEqual(["write a long list", "1. Apple"]);
  });

  test("an interrupt marker from an earlier turn does not move a new reply", () => {
    // History holds a finished steer: its marker stays in the transcript. The
    // next reply used to be pulled up to that marker while it streamed, above
    // the prompt it answers, and dropped back when the turn ended.
    const state = [
      server("srv-a0", "assistant", "partial old answer", 10),
      server("srv-m0", "user", "[Request interrupted by user]", 11),
      server("srv-u0", "user", "old steer", 12),
      server("srv-u1", "user", "write a long list", 100),
      sdkReply("sdk-r1", "1. Apple", { streaming: true, startedAt: 110 }),
    ];
    expect(texts(state)).toEqual([
      "partial old answer",
      "[Request interrupted by user]",
      "old steer",
      "write a long list",
      "1. Apple",
    ]);
  });

  test("the marker of this turn still lifts the answer it interrupted", () => {
    const state = [
      server("srv-u1", "user", "write a long list", 100),
      server("srv-m1", "user", "[Request interrupted by user]", 150),
      server("srv-u2", "user", "stop", 151),
      sdkReply("sdk-r1", "1. Apple", { streaming: true, startedAt: 110 }),
    ];
    expect(texts(state)).toEqual(["write a long list", "1. Apple", "[Request interrupted by user]", "stop"]);
  });
});


describe("a message the server holds is a card, not a bubble", () => {
  // The page guessed the agent was idle and drew a bubble; the server held the
  // send. The held card under the composer is the one place it shows.
  test("a bubble already drawn leaves the transcript", () => {
    const state = [
      server("srv-u1", "user", "start", 100),
      sdkSend("sdk-u2", "after that, say done", 200),
    ];
    const next = appendOmgTranscriptEvent(state, {
      type: "queue",
      queue: [{ id: "q1", text: "after that, say done", status: "held", createdAt: 201 }],
    });
    expect(next.map((message) => message.id)).toEqual(["srv-u1"]);
  });

  test("when the server sends it, it comes back as one bubble and settles", () => {
    let state = appendOmgTranscriptEvent([sdkSend("sdk-u2", "say done", 200)], {
      type: "queue",
      queue: [{ id: "q1", text: "say done", status: "held", createdAt: 201 }],
    });
    expect(state).toHaveLength(0);
    state = appendOmgTranscriptEvent(state, {
      type: "queue",
      queue: [{ id: "q1", text: "say done", status: "sending", createdAt: 201 }],
    });
    expect(state.map((message) => message.id)).toEqual(["queue-q1"]);
    state = appendOmgTranscriptEvent(state, {
      type: "message",
      message: { id: "srv-u2", role: "user", kind: "text", text: "say done", ts: 300 },
    });
    expect(state.map((message) => message.id)).toEqual(["srv-u2"]);
    expect(keys(state)).toEqual(["queue-q1"]);
  });
});

describe("an interrupted reply does not vanish", () => {
  test("a different finished reply leaves this browser's copy in place, finished", () => {
    const state = [
      server("srv-u1", "user", "list vegetables", 100),
      sdkReply("sdk-r1", "Carrot. Carrots are", { streaming: true, startedAt: 110 }),
      server("srv-u2", "user", "say done", 150),
    ];
    const next = appendOmgTranscriptEvent(state, {
      type: "message",
      message: { id: "srv-r2", role: "assistant", kind: "text", text: "done", ts: 160 },
    });
    expect(texts(next)).toEqual(["list vegetables", "Carrot. Carrots are", "say done", "done"]);
    expect(omgUIMessagesToMessages(next)[1]!.id).toBe("sdk-r1");
  });

  test("the end of the turn finishes this browser's copy and drops a stale live draft", () => {
    const draft: OmgChatMessage = {
      id: "draft-s1:5",
      role: "assistant",
      metadata: { omgMessage: { id: "draft-s1:5", draftOf: "draft-s1", role: "assistant", kind: "text", text: "stale", ts: 5 } },
      parts: [{ type: "text", text: "stale", state: "streaming" }],
    };
    const next = appendOmgTranscriptEvent([sdkReply("sdk-r1", "Carrot.", { streaming: true, startedAt: 1 }), draft], {
      type: "busy",
      busy: false,
    });
    expect(next.map((message) => message.id)).toEqual(["sdk-r1"]);
    expect(next[0]!.parts[0]).toMatchObject({ state: "done", text: "Carrot." });
  });
});
