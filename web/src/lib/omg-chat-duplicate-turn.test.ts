import { describe, expect, test } from "bun:test";
import { Chat } from "@ai-sdk/react";
import {
  OmgChatStreamOwnership,
  OmgChatTransport,
  appendOmgTranscriptEvent,
  commitHeldOmgRows,
  heldRowDuringOwnedStream,
  omgUIMessagesToMessages,
  type OmgChatMessage,
  type OmgTranscriptEvent,
} from "./omg-chat-transport";
import { buildChatRenderItems, splitQueuedRenderItems } from "./chat-render-items";

// Lives here rather than in test/ so `ai` / `@ai-sdk/react` resolve out of
// web/node_modules — this exercises the real AI SDK Chat, which is the whole
// point: the bug was in how our transport interacts with AbstractChat, not in
// any of our own reducers.
//
// Steering (sending again while the previous turn is still streaming) used to
// open a SECOND live stream. AbstractChat runs both responses concurrently but
// tracks a single `lastMessage`, and each write picks replace-vs-append by
// comparing its own message id against the tail of the list — so two live
// responses each found the other's message at the tail and pushed a fresh copy
// of themselves on every chunk. One steered turn then repeated its whole
// thinking + tools + text group down the transcript.

const TS = 1786185318060;
let sessionSeq = 0;
// Each test gets its own session id: the live-stream slot is keyed by session
// across transport instances, so sharing one id would leak state between tests.
const nextSid = () => `session-${++sessionSeq}`;

function harness(SID = nextSid()) {
  const listeners = new Set<(event: OmgTranscriptEvent) => void>();
  const posts: string[] = [];
  const transport = new OmgChatTransport({
    sessionId: SID,
    fetch: async (_url, init) => {
      posts.push((JSON.parse(String(init?.body)) as { text: string }).text);
      return new Response("{}", { status: 200 });
    },
    subscribeTranscript: (_sid, next) => {
      listeners.add(next);
      return () => void listeners.delete(next);
    },
  });
  const owned = new OmgChatStreamOwnership();
  const chat = new Chat<OmgChatMessage>({ id: SID, transport });
  // Replay everything the turn parked, in the order the server sent it.
  const commitHeld = () => {
    if (owned.owns(SID)) return;
    const next = commitHeldOmgRows(chat.messages, owned.release(SID));
    if (next !== chat.messages) chat.messages = next;
  };
  // The passive listener SessionChat installs next to the transport, including
  // its park-and-commit: a row that would land past the live turn waits in the
  // ownership record until the turn lets go.
  listeners.add((event) => {
    const streamActive = owned.owns(SID);
    if (streamActive) {
      const row = heldRowDuringOwnedStream(event);
      if (row) {
        owned.hold(SID, row);
        return;
      }
    } else {
      commitHeld();
    }
    const next = appendOmgTranscriptEvent(chat.messages, event, { streamActive });
    if (next !== chat.messages) chat.messages = next;
  });
  const emit = (event: OmgTranscriptEvent) => {
    for (const listener of [...listeners]) listener(event);
  };
  // `queued` mirrors SessionChat: a send that lands behind a running turn shows
  // as queued, because that is what the send queue is about to report anyway.
  const send = (text: string, queued = false) =>
    owned
      .run(SID, () =>
        chat.sendMessage({
          text,
          metadata: {
            omgMessage: { role: "user", kind: "text", text, ts: Date.now(), pending: true, queued },
          },
        }),
      )
      .finally(commitHeld);
  return { chat, emit, posts, send, SID };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The turn from the reported session: thinking, a streamed then finalized text
// block, and two WebSearch tool calls.
async function emitTurn(emit: (event: OmgTranscriptEvent) => void, SID: string) {
  emit({ type: "busy", busy: true });
  emit({ type: "message", message: { id: "row-329", role: "assistant", kind: "thinking", text: "(thinking)", ts: TS } });
  emit({ type: "ai_part", part: { type: "text-delta", id: `draft-${SID}`, text: "That reframes", reset: true, ts: TS + 1000 } });
  await sleep(10);
  emit({ type: "ai_part", part: { type: "text-delta", id: `draft-${SID}`, text: "That reframes the wedge", reset: true, ts: TS + 1200 } });
  await sleep(10);
  emit({ type: "message", message: { id: "row-330", role: "assistant", kind: "text", text: "That reframes the wedge", ts: TS + 1540 } });
  emit({ type: "message", message: { id: "row-331", role: "assistant", kind: "tool_use", text: 'WebSearch: {"query":"a"}', ts: TS + 1568 } });
  emit({ type: "message", message: { id: "row-332", role: "assistant", kind: "tool_use", text: 'WebSearch: {"query":"b"}', ts: TS + 1969 } });
  await sleep(200);
  emit({ type: "busy", busy: false });
  await sleep(200);
}

describe("steering an in-flight turn", () => {
  test("renders the turn once instead of repeating it per chunk", async () => {
    const { chat, emit, posts, send, SID } = harness();

    const first = send("what other personal assistant case?");
    await sleep(20);
    const second = send("A lot of people have been doing that.");
    await sleep(20);
    await emitTurn(emit, SID);
    await Promise.allSettled([first, second]);

    // Both sends still reach the agent — steering must not be swallowed.
    expect(posts).toEqual(["what other personal assistant case?", "A lot of people have been doing that."]);

    const ids = chat.messages.map((message) => message.id);
    expect(ids).toEqual([...new Set(ids)]);

    const rendered = omgUIMessagesToMessages(chat.messages);
    expect(rendered.filter((message) => message.kind === "thinking")).toHaveLength(1);
    expect(rendered.filter((message) => message.kind === "tool_use")).toHaveLength(2);
    expect(
      rendered.filter((message) => message.role === "assistant" && message.kind === "text"),
    ).toHaveLength(1);
  });

  test("still opens a live stream for the next send once the turn has settled", async () => {
    const { chat, emit, send, SID } = harness();

    await (async () => {
      const first = send("first");
      await sleep(20);
      const second = send("second");
      await emitTurn(emit, SID);
      await Promise.allSettled([first, second]);
    })();

    const third = send("third");
    await sleep(20);
    emit({ type: "busy", busy: true });
    emit({ type: "message", message: { id: "row-338", role: "assistant", kind: "text", text: "Good — that's simpler.", ts: TS + 32000 } });
    await sleep(200);
    emit({ type: "busy", busy: false });
    await sleep(200);
    await third;

    const rendered = omgUIMessagesToMessages(chat.messages);
    expect(rendered.filter((message) => message.text === "Good — that's simpler.")).toHaveLength(1);
  });

  test("a failed send releases the live-stream slot", async () => {
    const SID = nextSid();
    const listeners = new Set<(event: OmgTranscriptEvent) => void>();
    let ok = false;
    const transport = new OmgChatTransport({
      sessionId: SID,
      fetch: async () =>
        ok
          ? new Response("{}", { status: 200 })
          : new Response(JSON.stringify({ error: "session is busy" }), { status: 409 }),
      subscribeTranscript: (_sid, next) => {
        listeners.add(next);
        return () => void listeners.delete(next);
      },
    });

    await expect(
      transport.sendMessages({
        messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] }],
      } as Parameters<OmgChatTransport["sendMessages"]>[0]),
    ).rejects.toThrow("session is busy");
    // The stream nobody will consume must not keep the slot (or its listener).
    expect(listeners.size).toBe(0);

    ok = true;
    const stream = await transport.sendMessages({
      messages: [{ id: "u2", role: "user", parts: [{ type: "text", text: "hello again" }] }],
    } as Parameters<OmgChatTransport["sendMessages"]>[0]);
    expect(listeners.size).toBe(1);
    await stream.cancel();
  });

  test("hands a steering send an empty stream and reopens after the first ends", async () => {
    const SID = nextSid();
    const listeners = new Set<(event: OmgTranscriptEvent) => void>();
    const transport = new OmgChatTransport({
      sessionId: SID,
      fetch: async () => new Response("{}", { status: 200 }),
      subscribeTranscript: (_sid, next) => {
        listeners.add(next);
        return () => void listeners.delete(next);
      },
    });
    const send = (id: string, text: string) =>
      transport.sendMessages({
        messages: [{ id, role: "user", parts: [{ type: "text", text }] }],
      } as Parameters<OmgChatTransport["sendMessages"]>[0]);

    const first = await send("u1", "hello");
    expect(listeners.size).toBe(1);

    const steering = await send("u2", "steer");
    // Only one emitter is subscribed, and the steering send rides it: its own
    // stream carries no chunks, so the AI SDK opens no second response.
    expect(listeners.size).toBe(1);
    expect(await steering.getReader().read()).toEqual({ done: true, value: undefined });

    await first.cancel();
    expect(listeners.size).toBe(0);

    // Slot returned: the next turn gets a real live stream again.
    const later = await send("u3", "later");
    expect(listeners.size).toBe(1);
    await later.cancel();
  });
});

// Sending WHILE the assistant streams is the other half of the same AbstractChat
// rule. The steering fix above stops a SECOND response from opening; this is the
// FIRST response losing the tail. AbstractChat picks replace-vs-append per chunk
// by comparing its own message id against the tail of the list, so the steering
// user row it pushes itself — and the "[Request interrupted by user]" row the
// runtime writes right after — leave the still-streaming assistant message in
// the middle. The next chunk then pushes a fresh copy of that whole turn under
// the SAME id, and the transcript paints the interrupted answer twice: once
// above the interrupt divider and once below it.
describe("sending while the assistant is streaming", () => {
  // Live wall-clock stamps: upsertOmgUIMessage inserts transcript rows in
  // timestamp order against the locally-sent messages, which carry Date.now().
  const NOW = Date.now();

  function assistantCopies(messages: OmgChatMessage[], text: string) {
    return omgUIMessagesToMessages(messages).filter(
      (message) => message.role === "assistant" && message.text === text,
    );
  }

  test("an interrupted turn is not repeated around the interrupt divider", async () => {
    const { chat, emit, send, SID } = harness();
    const answer = "Good — that is the verification that counts.";

    const first = send("ship it");
    await sleep(20);
    emit({ type: "busy", busy: true });
    emit({ type: "ai_part", part: { type: "text-delta", id: `draft-${SID}`, text: "Good", reset: true, ts: NOW + 10 } });
    await sleep(10);
    emit({ type: "ai_part", part: { type: "text-delta", id: `draft-${SID}`, text: answer, reset: true, ts: NOW + 20 } });
    await sleep(10);

    // The user sends mid-stream. The runtime interrupts the in-flight turn,
    // persists the partial answer, writes the synthetic interrupt row, then
    // echoes the new user turn.
    const second = send("stop, do this instead");
    await sleep(20);
    emit({ type: "message", message: { id: "row-901", role: "assistant", kind: "text", text: answer, ts: NOW + 30 } });
    emit({ type: "message", message: { id: "row-902", role: "user", kind: "text", text: "[Request interrupted by user]", ts: NOW + 31 } });
    emit({ type: "message", message: { id: "row-903", role: "user", kind: "text", text: "stop, do this instead", ts: NOW + 32 } });
    await sleep(300);

    // Asserted while the session is still BUSY on purpose: the steered turn
    // starts immediately, so the busy:false sweep that drops stale streaming
    // drafts never runs. This is the state the reader is looking at.
    const ids = chat.messages.map((message) => message.id);
    expect(ids).toEqual([...new Set(ids)]);
    expect(assistantCopies(chat.messages, answer)).toHaveLength(1);

    // The virtualized transcript keys a row by its message id, so the two
    // copies were one row measured twice and printed at overlapping offsets.
    const keys = buildChatRenderItems(omgUIMessagesToMessages(chat.messages)).map((item) => item.key);
    expect(keys).toEqual([...new Set(keys)]);

    emit({ type: "busy", busy: false });
    await sleep(200);
    await Promise.allSettled([first, second]);
  });

  // The order the reader has to end up with. The server writes the interrupted
  // turn in one true sequence — the partial answer, the interrupt marker, then
  // the steering message that caused it — and the client's only job is to
  // mirror it.
  //
  // It used to invert it. AbstractChat appends the steering message the instant
  // it is sent, and every chunk of a live response picks replace-vs-append by
  // comparing its own id against the TAIL of the list, so withStreamingTurnLast
  // has to re-seat the streaming bubble at the end to stop the turn duplicating
  // itself. Re-seating necessarily pushed the still-streaming answer BELOW the
  // message that interrupted it, and there it stayed.
  test("commits an interrupted turn in the order the server wrote it", async () => {
    const { chat, emit, send, SID } = harness();
    // Server rows are written AFTER the local sends, so they must be stamped
    // after them: upsertOmgUIMessage places a settled row by timestamp.
    const base = Date.now() + 1_000;
    const answer = "Good — that is the verification that counts.";

    const first = send("ship it");
    await sleep(20);
    emit({ type: "busy", busy: true });
    emit({ type: "ai_part", part: { type: "text-delta", id: `draft-${SID}`, text: "Good", reset: true, ts: base + 10 } });
    await sleep(10);
    emit({ type: "ai_part", part: { type: "text-delta", id: `draft-${SID}`, text: answer, reset: true, ts: base + 20 } });
    await sleep(10);

    // Sent mid-stream, so it shows as queued rather than as a transcript row.
    const second = send("stop, do this instead", true);
    await sleep(20);

    // While the turn is still live the reader must NOT see the steering message
    // sitting above the answer it interrupted: it is pinned outside the
    // transcript, under the running turn, by splitQueuedRenderItems.
    const live = omgUIMessagesToMessages(chat.messages);
    const { items: liveItems, queued } = splitQueuedRenderItems(buildChatRenderItems(live));
    expect(liveItems.filter((item) => item.type === "msg").map((item) => item.message.text)).toEqual([
      "ship it",
      answer,
    ]);
    expect(queued.map((item) => (item.type === "msg" ? item.message.text : null))).toEqual([
      "stop, do this instead",
    ]);

    emit({ type: "message", message: { id: "row-901", role: "assistant", kind: "text", text: answer, ts: base + 30 } });
    emit({ type: "message", message: { id: "row-902", role: "user", kind: "text", text: "[Request interrupted by user]", ts: base + 31 } });
    emit({ type: "message", message: { id: "row-903", role: "user", kind: "text", text: "stop, do this instead", ts: base + 32 } });
    await sleep(300);
    emit({ type: "busy", busy: false });
    await sleep(200);
    await Promise.allSettled([first, second]);

    // The steered turn's own answer, on the far side of the interrupt.
    emit({ type: "message", message: { id: "row-904", role: "assistant", kind: "text", text: "Doing that instead.", ts: base + 40 } });
    await sleep(20);

    expect(omgUIMessagesToMessages(chat.messages).map((message) => message.text)).toEqual([
      "ship it",
      answer,
      "[Request interrupted by user]",
      "stop, do this instead",
      "Doing that instead.",
    ]);
  });

  test("a steering send alone does not duplicate the live turn", async () => {
    const { chat, emit, send, SID } = harness();

    const first = send("one");
    await sleep(20);
    emit({ type: "busy", busy: true });
    emit({ type: "ai_part", part: { type: "text-delta", id: `draft-${SID}`, text: "Alpha", reset: true, ts: NOW + 10 } });
    await sleep(20);
    const second = send("two");
    await sleep(20);
    emit({ type: "ai_part", part: { type: "text-delta", id: `draft-${SID}`, text: "Alpha beta", reset: true, ts: NOW + 20 } });
    await sleep(20);

    const ids = chat.messages.map((message) => message.id);
    expect(ids).toEqual([...new Set(ids)]);
    expect(assistantCopies(chat.messages, "Alpha beta")).toHaveLength(1);
    // Both sends still reach the agent.
    expect(chat.messages.filter((message) => message.role === "user")).toHaveLength(2);

    emit({ type: "busy", busy: false });
    await sleep(200);
    await Promise.allSettled([first, second]);
  });
});
