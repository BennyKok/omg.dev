import { describe, expect, test } from "bun:test";
import { buildChatRenderItems, splitQueuedRenderItems } from "./chat-render-items";
import {
  appendOmgTranscriptEvent,
  omgMessagesToUIMessages,
  omgUIMessagesToMessages,
  reconcileOmgQueueMessages,
  type OmgChatMessage,
  type OmgMessage,
} from "./omg-chat-transport";

// Queueing a message while a turn is running is a distinct state from steering:
// the agent has NOT read the text yet. Two things have to hold for the bubble to
// tell the truth about that — it has to keep carrying the flag through the
// render pipeline, and it has to stay pinned below the turn it is waiting on,
// which keeps producing output after the message was written.

const TS = 1786185318060;

function optimisticQueued(text: string, ts = TS): OmgChatMessage {
  return {
    id: `optimistic-${ts}`,
    role: "user",
    metadata: {
      omgMessage: { role: "user", kind: "text", text, ts, pending: true, queued: true },
    },
    parts: [{ type: "text", text, state: "done" }],
  };
}

function assistantRow(id: string, text: string, ts: number): OmgMessage {
  return { id, role: "assistant", kind: "text", text, ts };
}

describe("a message queued behind a running turn", () => {
  test("keeps its queued state through the render pipeline", () => {
    const [rendered] = omgUIMessagesToMessages([optimisticQueued("look at the tests too")]);
    expect(rendered.queued).toBe(true);
    expect(rendered.pending).toBe(true);
  });

  test("pins below output the turn produced after it was written", () => {
    const messages = omgUIMessagesToMessages([
      ...omgMessagesToUIMessages([
        { id: "row-1", role: "user", kind: "text", text: "start the refactor", ts: TS },
        assistantRow("row-2", "On it.", TS + 10),
      ]),
      optimisticQueued("look at the tests too", TS + 20),
      // The turn the queued message is waiting behind keeps going.
      ...omgMessagesToUIMessages([
        { id: "row-3", role: "assistant", kind: "tool_use", text: "Read: src/app.ts", ts: TS + 30 },
        assistantRow("row-4", "Refactor done.", TS + 40),
      ]),
    ]);

    const { items, queued } = splitQueuedRenderItems(buildChatRenderItems(messages));

    expect(queued).toHaveLength(1);
    expect(queued[0].type === "msg" && queued[0].message.text).toBe("look at the tests too");
    // Everything the agent actually produced stays in order, without it.
    expect(
      items.map((item) => (item.type === "msg" ? item.message.text : "(tools)")),
    ).toEqual(["start the refactor", "On it.", "(tools)", "Refactor done."]);
  });

  test("leaves an ordinary transcript untouched", () => {
    const messages = omgUIMessagesToMessages(
      omgMessagesToUIMessages([
        { id: "row-1", role: "user", kind: "text", text: "hello", ts: TS },
        assistantRow("row-2", "hi", TS + 10),
      ]),
    );
    const built = buildChatRenderItems(messages);
    const { items, queued } = splitQueuedRenderItems(built);
    expect(queued).toHaveLength(0);
    // Same array identity: no queued turn means no re-derivation of the stream.
    expect(items).toBe(built);
  });

  test("drops the queued state when the agent finally reads the message", () => {
    const text = "look at the tests too";
    const current = [optimisticQueued(text)];
    const next = appendOmgTranscriptEvent(current, {
      type: "message",
      message: { id: "row-9", role: "user", kind: "text", text, ts: TS + 5000 },
    });

    const rendered = omgUIMessagesToMessages(next);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].id).toBe("row-9");
    expect(rendered[0].queued).toBeUndefined();
    expect(splitQueuedRenderItems(buildChatRenderItems(rendered)).queued).toHaveLength(0);
  });

  test("restores the queued bubble from the server after session re-entry", () => {
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
      queued: true,
    });
  });

  test("replaces the local optimistic bubble with the stable queue row", () => {
    const next = reconcileOmgQueueMessages([optimisticQueued("look at the tests too")], [
      {
        id: "send-1",
        text: "look at the tests too",
        status: "queued",
        createdAt: TS,
      },
    ]);

    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("queue-send-1");
  });

  // The send queue reports a message behind a running turn as pending, then
  // sending, then queued, one event each. Reading `queued` straight off the
  // status dropped the bubble out of the queued rail and back into the
  // transcript in between, so one mid-turn send visibly flickered and re-ran
  // its entrance animation on every crossing.
  test("stays in the queued rail across the queue's own status churn", () => {
    let messages = [optimisticQueued("look at the tests too")];
    const rail: ("queued" | "list")[] = [];
    for (const status of ["pending", "sending", "queued"] as const) {
      messages = reconcileOmgQueueMessages(messages, [
        { id: "send-1", text: "look at the tests too", status, createdAt: TS },
      ]);
      const { queued } = splitQueuedRenderItems(
        buildChatRenderItems(omgUIMessagesToMessages(messages)),
      );
      rail.push(queued.length ? "queued" : "list");
    }
    expect(rail).toEqual(["queued", "queued", "queued"]);
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
    // A failed bubble is not pinned with the queued rail — it renders in place.
    expect(splitQueuedRenderItems(buildChatRenderItems(rendered)).queued).toHaveLength(0);
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
});
