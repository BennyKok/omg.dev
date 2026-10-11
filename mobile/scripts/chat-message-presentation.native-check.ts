import { expect, test } from "bun:test";
import { assistantMessageText, userMessageText } from "../src/omg/chat-message-presentation";
import { OPENCODE_RECOVERY_MESSAGE } from "../../src/agents/backends/opencode-turn-recovery";

test("old empty replies and provider errors show the same recovery copy as new failures", () => {
  expect(assistantMessageText("OpenCode returned no assistant output for omg/openai/gpt-6-luna; check the OpenCode provider logs.")).toBe(OPENCODE_RECOVERY_MESSAGE);
  expect(assistantMessageText("OpenCode turn failed for omg/openai/gpt-6-luna: Unauthorized")).toBe(OPENCODE_RECOVERY_MESSAGE);
});

test("normal assistant prose and quoted diagnostics stay readable", () => {
  const prose = "The log said: OpenCode turn failed for omg/model: Unauthorized";
  expect(assistantMessageText(prose)).toBe(prose);
  expect(assistantMessageText("```\nOpenCode turn failed for omg/model: Unauthorized\n```")).toContain("Unauthorized");
});

test("short prompts discard trailing spaces and empty lines only for display", () => {
  expect(userMessageText("Hi   \n\n")).toBe("Hi");
  expect(userMessageText("  First line\n  Second line\n")).toBe("  First line\n  Second line");
  expect(userMessageText("\n\n")).toBe("");
});
