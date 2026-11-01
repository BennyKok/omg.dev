import { describe, expect, test } from "bun:test";
import { buildChatRenderItems } from "./chat-render-items";
import {
  appendOmgTranscriptEvent,
  omgMessagesToUIMessages,
  omgUIMessagesToMessages,
  reconcileOmgQueueMessages,
  type OmgChatMessage,
  type OmgMessage,
} from "./omg-chat-transport";

// A message the agent has not read yet is never drawn in the transcript as a
// "queued" bubble. A send the server held is a card under the composer
// (held-queue-cards). A row the agent accepted behind its running turn draws
// nothing until its real transcript row lands. Only in-flight sends (pending,
// sending) and failed sends are bubbles.

const TS = 1786185318060;

function optimisticSend(text: string, ts = TS): OmgChatMessage {
  return {
    id: `optimistic-${ts}`,
    role: "user",
    metadata: {
      omgMessage: { role: "user", kind: "text", text, ts, pending: true },
    },
    parts: [{ type: "text", text, state: "done" }],
  };
}

function assistantRow(id: string, text: string, ts: number): OmgMessage {
  return { id, role: "assistant", kind: "text", text, ts };
}

describe("a message the agent has not read yet", () => {
  test("keeps an ordinary steering row visible when its server row arrives", () => {
    const text = "stop, do this instead";
    const optimistic: OmgChatMessage[] = [{
      ...optimisticSend(text),
      metadata: {
        omgMessage: { role: "user", kind: "text", text, ts: TS, pending: true },
      },
    }];
    const settled = appendOmgTranscriptEvent(
      optimistic,
      {
        type: "message",
        message: { id: "row-9", role: "user", kind: "text", text, ts: TS + 1 },
      },
      { streamActive: true },
    );

    expect(settled).toHaveLength(1);
    expect(omgUIMessagesToMessages(settled)[0]).toMatchObject({
      id: "row-9",
      text,
    });
  });

  test("the server row replaces the in-flight bubble when the agent reads it", () => {
    const text = "look at the tests too";
    const current = [optimisticSend(text)];
    const next = appendOmgTranscriptEvent(current, {
      type: "message",
      message: { id: "row-9", role: "user", kind: "text", text, ts: TS + 5000 },
    });

    const rendered = omgUIMessagesToMessages(next);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].id).toBe("row-9");
    expect(buildChatRenderItems(rendered)[0]?.key).toBe(`optimistic-${TS}`);
  });

  test("restores an in-flight bubble from the server after session re-entry", () => {
    const current = omgMessagesToUIMessages([
      { id: "row-1", role: "assistant", kind: "text", text: "Still working.", ts: TS },
    ]);
    const next = reconcileOmgQueueMessages(current, [
      {
        id: "send-1",
        text: "look at the tests too",
        status: "queued",
        createdAt: TS + 20,
      },
    ]);

    const rendered = omgUIMessagesToMessages(next);
    expect(rendered.at(-1)).toMatchObject({
      id: "queue-send-1",
      role: "user",
      text: "look at the tests too",
      pending: true,
    });
    expect(rendered.at(-1)).not.toHaveProperty("queued");
  });

  test("replaces the local optimistic bubble with the stable queue row", () => {
    const next = reconcileOmgQueueMessages([optimisticSend("look at the tests too")], [
      {
        id: "send-1",
        text: "look at the tests too",
        status: "queued",
        createdAt: TS,
      },
    ]);

    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("queue-send-1");
    // The server id changes for reconciliation. The React row identity does not.
    expect(next[0].metadata?.omgMessage?.renderKey).toBe(`optimistic-${TS}`);
  });

  test("keeps one ordinary row through delivery and its live server echo", () => {
    const text = "stop, do this instead";
    const optimistic: OmgChatMessage[] = [{
      ...optimisticSend(text),
      metadata: {
        omgMessage: { role: "user", kind: "text", text, ts: TS, pending: true },
      },
    }];
    const queued = reconcileOmgQueueMessages(optimistic, [
      { id: "send-1", text, status: "queued", createdAt: TS, queuedBehindTurn: false },
    ]);
    const duringDelivered = appendOmgTranscriptEvent(
      queued,
      {
        type: "queue", queue: [{ id: "send-1", text, status: "delivered", createdAt: TS, queuedBehindTurn: false }],
      },
      { streamActive: true },
    );
    const settled = appendOmgTranscriptEvent(
      duringDelivered,
      { type: "message", message: { id: "row-9", role: "user", kind: "text", text, ts: TS + 1 } },
      { streamActive: true },
    );

    expect([optimistic.length, queued.length, duringDelivered.length, settled.length]).toEqual([
      1, 1, 1, 1,
    ]);
    expect(
      [optimistic, queued, duringDelivered, settled].map(
        (messages) => buildChatRenderItems(omgUIMessagesToMessages(messages))[0]?.key,
      ),
    ).toEqual(Array(4).fill(`optimistic-${TS}`));
  });

  test("keeps one ordinary bubble through the queue's status churn", () => {
    const text = "stop, do this instead";
    let messages: OmgChatMessage[] = [{
      ...optimisticSend(text),
      metadata: {
        omgMessage: { role: "user", kind: "text", text, ts: TS, pending: true },
      },
    }];
    for (const status of ["pending", "sending", "queued"] as const) {
      messages = reconcileOmgQueueMessages(messages, [
        { id: "send-1", text, status, createdAt: TS, queuedBehindTurn: false },
      ]);
      const rendered = omgUIMessagesToMessages(messages);
      expect(rendered).toHaveLength(1);
      expect(rendered[0]).not.toHaveProperty("queued");
      const items = buildChatRenderItems(rendered);
      expect(items[0]?.type === "msg" && items[0].message.text).toBe(text);
    }
  });

  test("removes the restored bubble when the queue reports delivery", () => {
    const queued = reconcileOmgQueueMessages([], [
      {
        id: "send-1",
        text: "look at the tests too",
        status: "queued",
        createdAt: TS,
      },
    ]);
    const delivered = reconcileOmgQueueMessages(queued, [
      {
        id: "send-1",
        text: "look at the tests too",
        status: "delivered",
        createdAt: TS,
      },
    ]);

    expect(delivered).toHaveLength(0);
  });

  test("keeps a later identical follow-up visible until its own row lands", () => {
    const current = omgMessagesToUIMessages([
      { id: "row-1", role: "user", kind: "text", text: "looks good", ts: TS },
    ]);
    const next = reconcileOmgQueueMessages(current, [
      { id: "send-1", text: "looks good", status: "queued", createdAt: TS - 100 },
      { id: "send-2", text: "looks good", status: "queued", createdAt: TS - 50 },
    ]);

    // The first send claims the transcript row; the second keeps its bubble.
    expect(next.some((message) => message.id === "queue-send-1")).toBe(false);
    expect(next.some((message) => message.id === "queue-send-2")).toBe(true);
  });

  test("a delivered send still claims its transcript row", () => {
    const current = omgMessagesToUIMessages([
      { id: "row-1", role: "user", kind: "text", text: "yes", ts: TS },
    ]);
    const next = reconcileOmgQueueMessages(current, [
      { id: "send-1", text: "yes", status: "delivered", createdAt: TS - 100 },
      { id: "send-2", text: "yes", status: "queued", createdAt: TS - 50 },
    ]);

    expect(next.some((message) => message.id === "queue-send-2")).toBe(true);
  });

  test("hydrates a failed send with its error and keeps it through the render pipeline", () => {
    const next = reconcileOmgQueueMessages([], [
      {
        id: "send-1",
        text: "deploy it",
        status: "failed",
        error: "message never left the input box after retries",
        createdAt: TS,
      },
    ]);

    const rendered = omgUIMessagesToMessages(next);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toMatchObject({
      id: "queue-send-1",
      role: "user",
      failed: true,
      queueError: "message never left the input box after retries",
      queueId: "send-1",
    });
    expect(rendered[0].pending).toBeUndefined();
  });

  test("a failed bubble becomes pending again when the queue reports the retry", () => {
    const failed = reconcileOmgQueueMessages([], [
      { id: "send-1", text: "deploy it", status: "failed", error: "boom", createdAt: TS },
    ]);
    const retried = reconcileOmgQueueMessages(failed, [
      { id: "send-1", text: "deploy it", status: "pending", createdAt: TS },
    ]);

    const rendered = omgUIMessagesToMessages(retried);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toMatchObject({ id: "queue-send-1", pending: true });
    expect(rendered[0].failed).toBeUndefined();
  });

  // The page guesses that the agent is idle and draws an ordinary bubble. The
  // server, which owns the decision, finds the agent busy and holds the send.
  // The bubble must go: the held card under the composer is the only place a
  // held message shows. It used to stay as a dashed "Queued" bubble.
  test("a send the server held leaves the transcript for the held card", () => {
    const text = "why does this not apply on PR changes?";
    const current = [
      ...omgMessagesToUIMessages([
        { id: "row-1", role: "user", kind: "text", text: "start the refactor", ts: TS - 100 },
      ]),
      optimisticSend(text),
    ];
    const next = reconcileOmgQueueMessages(current, [
      { id: "held-1", text, status: "held", createdAt: TS + 5, queuedBehindTurn: true },
    ]);

    const rendered = omgUIMessagesToMessages(next);
    expect(rendered.map((message) => message.text)).toEqual(["start the refactor"]);
    expect(rendered.some((message) => message.queueId === "held-1")).toBe(false);
  });

  test("a held send with the same text as an older settled turn only drops the new bubble", () => {
    const text = "looks good";
    const current = [
      ...omgMessagesToUIMessages([{ id: "row-1", role: "user", kind: "text", text, ts: TS - 100 }]),
      optimisticSend(text),
    ];
    const next = reconcileOmgQueueMessages(current, [
      { id: "held-1", text, status: "held", createdAt: TS + 5, queuedBehindTurn: true },
    ]);

    expect(omgUIMessagesToMessages(next).map((message) => message.id)).toEqual(["row-1"]);
  });

  // An agent update accepted behind the running turn sits in the agent's own
  // queue. It is not drawn until the agent reads it and its row lands.
  test("a row the agent queued behind its turn draws no bubble", () => {
    const text = "[subagent complete] tests pass";
    const waiting = reconcileOmgQueueMessages([], [
      { id: "send-1", text, status: "queued", createdAt: TS, queuedBehindTurn: true },
    ]);
    expect(waiting).toHaveLength(0);

    const read = appendOmgTranscriptEvent(waiting, {
      type: "message",
      message: { id: "row-9", role: "user", kind: "text", text, ts: TS + 5000 },
    });
    expect(omgUIMessagesToMessages(read).map((message) => message.id)).toEqual(["row-9"]);
  });
});
