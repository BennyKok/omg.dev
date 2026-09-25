import { describe, expect, test } from "bun:test";
import { OpencodeDraftTracker, type OpencodeDraft, type OpencodeDraftPart } from "./opencode-draft.ts";

// Part order and shape follow a stored DeepSeek V4 Flash session in
// opencode.db: every step is a new assistant message with its own reasoning
// part, text parts are rare, and each update is a full snapshot of one part.
function feed(parts: OpencodeDraftPart[]): OpencodeDraft[] {
  const tracker = new OpencodeDraftTracker();
  const shown: OpencodeDraft[] = [];
  for (const part of parts) {
    const next = tracker.apply(part);
    if (next) shown.push(next);
  }
  return shown;
}

describe("OpencodeDraftTracker", () => {
  test("publishes reasoning as thinking, never as answer text", () => {
    const shown = feed([
      { id: "prt_r1", type: "reasoning", messageID: "msg_1", text: "The user wants me to build a party quiz game." },
      { id: "prt_r2", type: "reasoning", messageID: "msg_2", text: "Let me look at the current directory." },
    ]);
    expect(shown.length).toBe(2);
    expect(shown.every((draft) => draft.kind === "thinking")).toBe(true);
    expect(shown.some((draft) => draft.kind === "text")).toBe(false);
  });

  test("reasoning from a later step does not replace answer text on screen", () => {
    const shown = feed([
      { id: "prt_t1", type: "text", messageID: "msg_1", text: "All 318 mock tests pass." },
      { id: "prt_r2", type: "reasoning", messageID: "msg_2", text: "Now I should commit." },
      { id: "prt_r3", type: "reasoning", messageID: "msg_3", text: "Check the diff first." },
    ]);
    expect(shown).toEqual([{ text: "All 318 mock tests pass.", kind: "text" }]);
  });

  test("a growing text snapshot replaces only its own slot", () => {
    const shown = feed([
      { id: "prt_t1", type: "text", messageID: "msg_1", text: "First" },
      { id: "prt_t1", type: "text", messageID: "msg_1", text: "First part." },
      { id: "prt_t2", type: "text", messageID: "msg_1", text: "Second part." },
      { id: "prt_t2", type: "text", messageID: "msg_1", text: "Second part, longer." },
    ]);
    expect(shown.map((draft) => draft.text)).toEqual([
      "First",
      "First part.",
      "First part.\n\nSecond part.",
      "First part.\n\nSecond part, longer.",
    ]);
  });

  test("text from a newer assistant message starts a fresh answer, like the final commit", () => {
    const shown = feed([
      { id: "prt_t1", type: "text", messageID: "msg_1", text: "Step one answer." },
      { id: "prt_t2", type: "text", messageID: "msg_2", text: "Final answer." },
    ]);
    expect(shown[shown.length - 1]).toEqual({ text: "Final answer.", kind: "text" });
  });

  test("ignores empty reasoning and non-text parts", () => {
    const shown = feed([
      { id: "prt_r1", type: "reasoning", messageID: "msg_1", text: "  " },
      { id: "prt_tool", type: "tool", messageID: "msg_1" },
      { id: "prt_t1", type: "text", messageID: "msg_1", text: "" },
    ]);
    expect(shown).toEqual([]);
  });

  test("reset forgets the answer so the next turn can show thinking again", () => {
    const tracker = new OpencodeDraftTracker();
    tracker.apply({ id: "prt_t1", type: "text", messageID: "msg_1", text: "Done." });
    expect(tracker.apply({ id: "prt_r1", type: "reasoning", messageID: "msg_2", text: "hm" })).toBeNull();
    tracker.reset();
    expect(tracker.apply({ id: "prt_r2", type: "reasoning", messageID: "msg_3", text: "next turn" })).toEqual({
      text: "next turn",
      kind: "thinking",
    });
  });
});
