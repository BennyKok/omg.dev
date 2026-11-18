import { describe, expect, test } from "bun:test";
import { buildBtwPrompt } from "./btw.ts";

describe("buildBtwPrompt", () => {
  test("includes session metadata, transcript context, prior /btw turns, and side question", () => {
    const prompt = buildBtwPrompt({
      sessionTitle: "Fix sendq retry",
      agent: "claude",
      cwd: "/home/dev/repo",
      messages: [
        { role: "user", kind: "text", text: "Check sendq.ts" },
        { role: "assistant", kind: "text", text: "I see the retry loop." },
      ],
      history: [
        { role: "user", text: "What file?" },
        { role: "assistant", text: "src/sendq.ts" },
      ],
      question: "Why does it probe?",
    });

    expect(prompt).toContain("Session: Fix sendq retry");
    expect(prompt).toContain("Agent: claude");
    expect(prompt).toContain("User: Check sendq.ts");
    expect(prompt).toContain("Assistant: I see the retry loop.");
    expect(prompt).toContain("Side User: What file?");
    expect(prompt).toContain("Side Assistant: src/sendq.ts");
    expect(prompt).toContain("## Side Question\nWhy does it probe?");
  });

  test("keeps the most recent transcript messages within maxContextChars", () => {
    const prompt = buildBtwPrompt({
      messages: [
        { role: "user", kind: "text", text: "OLD_MESSAGE_THAT_SHOULD_BE_DROPPED" },
        { role: "assistant", kind: "text", text: "RECENT_MESSAGE" },
      ],
      question: "What happened?",
      maxContextChars: 35,
    });

    expect(prompt).not.toContain("OLD_MESSAGE_THAT_SHOULD_BE_DROPPED");
    expect(prompt).toContain("RECENT_MESSAGE");
  });

  test("handles empty transcript gracefully", () => {
    const prompt = buildBtwPrompt({
      messages: [],
      question: "Hello?",
    });

    expect(prompt).toContain("(No prior messages in this session yet.)");
    expect(prompt).toContain("## Side Question\nHello?");
  });
});
