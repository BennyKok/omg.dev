import { afterAll, beforeEach, expect, mock, test } from "bun:test";

const shown: { title: string; description?: string }[] = [];
const logged: { event: string; fields: Record<string, unknown> }[] = [];
mock.module("./notify", () => ({
  toast: { error: (title: string, options?: { description?: string }) => shown.push({ title, description: options?.description }) },
}));
mock.module("./evlog", () => ({
  evlog: (event: string, fields: Record<string, unknown> = {}) => logged.push({ event, fields }),
}));
const { logChatError, notifyChatFailure } = await import("./chat-failure");

beforeEach(() => {
  shown.length = 0;
  logged.length = 0;
});
afterAll(() => mock.restore());

test("a failed action says what did not happen, never what the server said", () => {
  notifyChatFailure("Message not sent", "sid-1", new Error("not found"), "Your text is back in the box.");
  expect(shown).toEqual([{ title: "Message not sent", description: "Your text is back in the box." }]);
  expect(JSON.stringify(shown)).not.toContain("not found");
  // The server's words are kept for diagnosis.
  expect(logged).toEqual([{ event: "chat_error", fields: { source: "Message not sent", sid: "sid-1", error: "not found" } }]);
});

test("a background failure is only logged", () => {
  logChatError("history", "sid-2", "not found");
  expect(shown).toEqual([]);
  expect(logged[0]?.fields).toEqual({ source: "history", sid: "sid-2", error: "not found" });
});
