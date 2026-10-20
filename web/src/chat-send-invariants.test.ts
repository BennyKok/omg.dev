import { expect, test } from "bun:test";
import { OmgChatTransport } from "./lib/omg-chat-transport";

// Guide acknowledgement must preserve the caller's send mode and must never
// serialize its callbacks into the wire request.
test.each(["steer", "queue"])("guide sends preserve %s mode", async mode => {
  const bodies: unknown[] = [];
  let accepted = 0;
  const transport = new OmgChatTransport({
    sessionId: "guided",
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({});
    },
  });
  const stream = await transport.sendMessages({
    chatId: "guided", trigger: "submit-message", messageId: undefined, abortSignal: undefined,
    messages: [{ id: "message", role: "user", parts: [{ type: "text", text: "Change the app" }] }],
    body: { mode, passive: true },
    metadata: { onAccepted: () => accepted++ },
  });
  expect(bodies).toEqual([{ text: "Change the app", mode }]);
  expect(accepted).toBe(1);
  await stream.cancel();
});
