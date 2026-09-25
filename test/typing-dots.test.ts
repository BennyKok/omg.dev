import { describe, expect, test } from "bun:test";
import { showsTypingIndicator } from "../web/src/lib/typing-dots.ts";

const tools = { type: "tools" as const, key: "t", items: [{ id: "1", kind: "tool_use", text: "Bash: ls" }] };
const text = { type: "msg" as const, key: "m", message: { id: "2", kind: "text", text: "hi" } };
const thinking = { type: "msg" as const, key: "k", message: { id: "3", kind: "thinking", text: "..." } };

describe("typing dots", () => {
  test("hide when the session is idle", () => {
    expect(showsTypingIndicator(false, text, false)).toBe(false);
  });

  test("show while busy after a text reply", () => {
    expect(showsTypingIndicator(true, text, false)).toBe(true);
    expect(showsTypingIndicator(true, undefined, false)).toBe(true);
  });

  test("hide under a live tool run, which is already the working row", () => {
    expect(showsTypingIndicator(true, tools, false)).toBe(false);
  });

  test("hide under reasoning at the tail", () => {
    expect(showsTypingIndicator(true, thinking, false)).toBe(false);
  });

  test("a bot keeps its working face under a tool run", () => {
    expect(showsTypingIndicator(true, tools, true)).toBe(true);
  });
});
