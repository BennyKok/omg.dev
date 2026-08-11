import { describe, expect, test } from "bun:test";
import { buildChatRenderItems, splitQueuedRenderItems } from "./chat-render-items";
import {
  appendOmgTranscriptEvent,
  omgMessagesToUIMessages,
  omgUIMessagesToMessages,
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
});
