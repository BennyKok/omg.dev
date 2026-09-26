import { describe, expect, test } from "bun:test";
import type { ChatRenderItem, ChatRenderMessage } from "./chat-render-items";
import { rowsWhileLive, showsTypingIndicator } from "./typing-dots";

const tools: ChatRenderItem<ChatRenderMessage> = {
  type: "tools",
  key: "t1",
  items: [{ kind: "tool_use", text: "Bash: npm install", ts: 1 }],
};
const draft = (text: string): ChatRenderItem<ChatRenderMessage> => ({
  type: "msg",
  key: "d1",
  message: { id: "draft-1", role: "assistant", kind: "text", text },
});

describe("an empty live draft does not hide the running work", () => {
  test("a draft with no finished paragraph after a work row is left out while busy", () => {
    const items = [tools, draft("I will now")];
    const rows = rowsWhileLive(true, items);
    expect(rows).toEqual([tools]);
    // The work row is the tail, so it is the one live indicator.
    expect(showsTypingIndicator(true, rows[rows.length - 1], false)).toBe(false);
  });

  test("a draft with a finished paragraph shows", () => {
    const items = [tools, draft("Setting up the app.\n\n")];
    expect(rowsWhileLive(true, items)).toBe(items);
  });

  test("nothing is left out when idle, or when the draft does not follow work", () => {
    expect(rowsWhileLive(false, [tools, draft("")])).toHaveLength(2);
    const user: ChatRenderItem<ChatRenderMessage> = { type: "msg", key: "u", message: { role: "user", kind: "text", text: "hi" } };
    expect(rowsWhileLive(true, [user, draft("")])).toHaveLength(2);
  });
});
