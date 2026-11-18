import { describe, expect, test } from "bun:test";
import { hasComposerHighlight, tokenizeComposerText } from "./composer-highlight";

describe("tokenizeComposerText", () => {
  test("highlights leading slash commands like /btw and /fast", () => {
    const btw = tokenizeComposerText("/btw why did it fail?");
    expect(btw).toEqual([
      { text: "/btw", kind: "command" },
      { text: " why did it fail?", kind: "plain" },
    ]);
    expect(hasComposerHighlight(btw)).toBe(true);

    const fast = tokenizeComposerText("  /fast on");
    expect(fast).toEqual([
      { text: "  ", kind: "plain" },
      { text: "/fast", kind: "command" },
      { text: " on", kind: "plain" },
    ]);
  });

  test("highlights @mentions anywhere at word boundaries", () => {
    const segments = tokenizeComposerText("/btw ask @reviewer about @src/sendq.ts");
    expect(segments).toEqual([
      { text: "/btw", kind: "command" },
      { text: " ask ", kind: "plain" },
      { text: "@reviewer", kind: "mention" },
      { text: " about ", kind: "plain" },
      { text: "@src/sendq.ts", kind: "mention" },
    ]);
  });

  test("does not highlight emails or mid-sentence slashes", () => {
    const email = tokenizeComposerText("mail dev@example.com or check src/btw.ts");
    expect(email).toEqual([
      { text: "mail dev@example.com or check src/btw.ts", kind: "plain" },
    ]);
    expect(hasComposerHighlight(email)).toBe(false);
  });

  test("returns empty array for empty text", () => {
    expect(tokenizeComposerText("")).toEqual([]);
  });
});
