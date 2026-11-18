import { describe, expect, test } from "bun:test";
import { hasComposerHighlight, tokenizeComposerText } from "./composer-highlight";

describe("tokenizeComposerText", () => {
  test("highlights leading /btw command", () => {
    const segments = tokenizeComposerText("/btw why did it fail?");
    expect(segments).toEqual([
      { text: "/btw", kind: "btw" },
      { text: " why did it fail?", kind: "plain" },
    ]);
    expect(hasComposerHighlight(segments)).toBe(true);
  });

  test("preserves leading whitespace before /btw", () => {
    expect(tokenizeComposerText("  /BTW")).toEqual([
      { text: "  ", kind: "plain" },
      { text: "/BTW", kind: "btw" },
    ]);
  });

  test("does not highlight /btw inside a word or mid-sentence", () => {
    const mid = tokenizeComposerText("ask /btw later");
    expect(mid).toEqual([{ text: "ask /btw later", kind: "plain" }]);
    expect(hasComposerHighlight(mid)).toBe(false);

    const joined = tokenizeComposerText("/btwsomething");
    expect(joined).toEqual([{ text: "/btwsomething", kind: "plain" }]);
    expect(hasComposerHighlight(joined)).toBe(false);
  });

  test("returns empty array for empty text", () => {
    expect(tokenizeComposerText("")).toEqual([]);
  });
});
