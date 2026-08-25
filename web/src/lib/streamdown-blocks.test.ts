import { describe, expect, test } from "bun:test";
import { parseMarkdownIntoBlocks } from "streamdown";

/**
 * Smoke the Streamdown splitter we inject into the transcript height model.
 * The model never reimplements block boundaries; if this export changes shape
 * or stops keeping fences together, unmounted-row estimates go wrong.
 */
describe("parseMarkdownIntoBlocks", () => {
  test("is the named export the height model imports", () => {
    expect(typeof parseMarkdownIntoBlocks).toBe("function");
  });

  test("keeps a fenced block together even with blank lines inside it", () => {
    const blocks = parseMarkdownIntoBlocks("before\n\n```ts\na\n\nb\n```\n\nafter")
      .filter((block) => block.trim().length > 0);
    expect(blocks).toEqual(["before", "```ts\na\n\nb\n```", "after"]);
  });

  test("keeps a GFM table as one block", () => {
    const blocks = parseMarkdownIntoBlocks("para\n\n| a | b |\n| --- | --- |\n| 1 | 2 |")
      .filter((block) => block.trim().length > 0);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toContain("| a | b |");
  });
});
