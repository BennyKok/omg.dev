import { expect, test } from "bun:test";
import { Chat } from "@ai-sdk/react";
import {
  createOmgMessageProjector,
  omgMessagesToUIMessages,
  omgUIMessagesToMessages,
  type OmgChatMessage,
} from "./omg-chat-transport";

test("sending and streaming keep settled rows stable using the real SDK state", async () => {
  const history = omgMessagesToUIMessages(
    Array.from({ length: 1000 }, (_, i) => ({
      id: `history-${i}`,
      role: i % 2 ? "assistant" : "user",
      kind: "text",
      text: `Message ${i}`,
      ts: i,
    })),
  );
  let stream!: ReadableStreamDefaultController<any>;
  const chat = new Chat<OmgChatMessage>({
    id: "projector",
    messages: history,
    transport: {
      sendMessages: async () =>
        new ReadableStream({
          start(controller) {
            stream = controller;
          },
        }),
      reconnectToStream: async () => null,
    },
  });
  const project = createOmgMessageProjector();
  const initial = project(chat.messages);
  const sending = chat.sendMessage({ text: "Next message" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const sent = project(chat.messages);
  expect(sent.slice(0, 1000).every((row, i) => row === initial[i])).toBe(true);
  expect(sent.at(-1)?.text).toBe("Next message");
  return (async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    stream.enqueue({ type: "start", messageId: "reply" });
    stream.enqueue({ type: "text-start", id: "text" });
    for (let i = 0; i < 20; i++) {
      stream.enqueue({ type: "text-delta", id: "text", delta: `${i} ` });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const rows = project(chat.messages);
      expect(rows).toEqual(omgUIMessagesToMessages(chat.messages));
      expect(rows.slice(0, 1000).every((row, n) => row === initial[n])).toBe(
        true,
      );
      expect(rows.at(-1)?.text).toContain(`${i} `);
    }
    stream.enqueue({ type: "text-end", id: "text" });
    stream.enqueue({ type: "finish" });
    stream.close();
    await sending;
    expect(project(chat.messages).at(-1)?.id).toBe("reply");
  })();
});

test("replacement, metadata changes, mixed parts and interrupt ordering stay current", () => {
  const project = createOmgMessageProjector();
  const messages: OmgChatMessage[] = [
    {
      id: "a",
      role: "assistant",
      metadata: { omgMessage: { ts: 1 } },
      parts: [
        { type: "text", text: "", state: "streaming" },
        { type: "reasoning", text: "Working", state: "done" },
        { type: "file", mediaType: "image/png", url: "/image.png" },
        {
          type: "data-omgMessage",
          data: { id: "tool", kind: "tool_use", text: "Read file" },
        },
      ],
    },
  ];
  expect(project(messages)).toEqual(omgUIMessagesToMessages(messages));
  const settled = {
    ...messages[0]!,
    parts: [{ type: "text", text: "Done", state: "done" }],
  } as OmgChatMessage;
  const pending = omgMessagesToUIMessages([
    {
      id: "user",
      role: "user",
      kind: "text",
      text: "<next>",
      pending: true,
      ts: 3,
    },
  ])[0]!;
  const marker = omgMessagesToUIMessages([
    {
      id: "marker",
      role: "user",
      kind: "text",
      text: "[Request interrupted by user]",
      ts: 2,
    },
  ])[0]!;
  const ordered = [pending, marker, settled];
  expect(project(ordered)).toEqual(omgUIMessagesToMessages(ordered));
  const changed = {
    ...pending,
    metadata: {
      omgMessage: {
        ...pending.metadata!.omgMessage,
        pending: false,
        queued: true,
      },
    },
  };
  expect(project([changed])[0]).toMatchObject({
    pending: false,
    queued: true,
    html: "&lt;next&gt;",
  });
  expect(project([changed])[0]).not.toBe(project([pending])[0]);
  expect(project([])).toEqual([]);
});
