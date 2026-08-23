import { describe, expect, test } from "bun:test";

import {
  blockBox,
  classifyBlock,
  COLLAPSED_THINKING_PX,
  estimateRowHeight,
  INTERRUPTED_PX,
  inlineRuns,
  LINK_CHROME_PX,
  markdownHeight,
  mediaHeight,
  MEDIA_CARD_CHROME_PX,
  MEDIA_MAX_PX,
  messageRowHeight,
  RICH_INLINE_RE,
  ROW_GAP_PX,
  SPEAKER_CHANGE_PX,
  TOOL_PILL_PX,
  USER_BUBBLE_CLAMP_LINES,
  USER_BUBBLE_TOGGLE_PX,
  type RowContext,
  type RowMessage,
  type TextMeasurer,
} from "./chat-row-height";
import type { BoxMetrics, MarkdownMetrics } from "./markdown-metrics";

// A deterministic stand-in for pretext. Every glyph is CHAR_PX wide, so a line
// count is exact arithmetic and the tests assert the model, not a font.
const CHAR_PX = 10;

function box(over: Partial<BoxMetrics> = {}): BoxMetrics {
  return {
    font: "normal 400 17px sans",
    fontSize: 17,
    lineHeight: 20,
    letterSpacing: 0,
    marginTop: 0,
    marginBottom: 0,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    paddingRight: 0,
    borderTop: 0,
    borderBottom: 0,
    borderLeft: 0,
    ...over,
  };
}

function metrics(over: Partial<MarkdownMetrics> = {}): MarkdownMetrics {
  return {
    metricsVersion: 1,
    rowClass: "markdown msg-text",
    contentWidth: 100,
    root: box(),
    blocks: {
      p: box({ marginTop: 7, marginBottom: 7 }),
      h1: box({ fontSize: 14, lineHeight: 18, marginTop: 9, marginBottom: 5 }),
      h2: box({ fontSize: 14, lineHeight: 18, marginTop: 9, marginBottom: 5, paddingBottom: 3, borderBottom: 0.5 }),
      h3: box({ fontSize: 14, lineHeight: 18, marginTop: 9, marginBottom: 5 }),
      ul: box({ marginTop: 6, marginBottom: 6, paddingLeft: 18 }),
      ol: box({ marginTop: 6, marginBottom: 6, paddingLeft: 18 }),
      li: box({ marginTop: 2, marginBottom: 2 }),
      pre: box({ fontSize: 11, lineHeight: 17, marginTop: 8, marginBottom: 8, paddingTop: 10, paddingBottom: 10 }),
      blockquote: box({ marginTop: 10, marginBottom: 10, paddingLeft: 12, paddingRight: 12, borderLeft: 3, paddingTop: 2, paddingBottom: 2 }),
      table: box({ marginTop: 10, marginBottom: 10 }),
      th: box({ paddingTop: 5, paddingBottom: 5, paddingLeft: 8, paddingRight: 8, borderTop: 0.5 }),
      td: box({ paddingTop: 5, paddingBottom: 5, paddingLeft: 8, paddingRight: 8, borderTop: 0.5 }),
      hr: box({ marginTop: 13, marginBottom: 13, borderTop: 0.5 }),
    },
    inline: {
      strong: { font: "normal 600 17px sans", letterSpacing: 0, extraWidth: 0 },
      em: { font: "italic 400 17px sans", letterSpacing: 0, extraWidth: 0 },
      a: { font: "normal 400 17px sans", letterSpacing: 0, extraWidth: 0 },
      code: { font: "normal 400 15px mono", letterSpacing: 0, extraWidth: 12 },
    },
    richLine: 0,
    codeBlock: null,
    ...over,
  };
}

const measurer: TextMeasurer = {
  plain(text, _font, width, lineHeight) {
    if (!text) return lineHeight;
    return Math.max(1, Math.ceil((text.length * CHAR_PX) / Math.max(1, width))) * lineHeight;
  },
  rich(runs, width, lineHeight) {
    const total = runs.reduce(
      (sum, run) => sum + run.text.length * CHAR_PX + (run.extraWidth ?? 0),
      0,
    );
    return Math.max(1, Math.ceil(total / Math.max(1, width))) * lineHeight;
  },
};

function context(over: Partial<RowContext> = {}): RowContext {
  return {
    assistant: metrics(),
    measure: measurer,
    // A stand-in for streamdown's parseMarkdownIntoBlocks: blank-line split.
    splitBlocks: (markdown) => markdown.split(/\n{2,}/),
    ...over,
  };
}

describe("classifyBlock", () => {
  test("recognises a paragraph and joins its soft breaks", () => {
    expect(classifyBlock("one\ntwo")).toEqual({ kind: "paragraph", text: "one two" });
  });

  test("recognises headings up to level 3", () => {
    expect(classifyBlock("# Title")).toEqual({ kind: "heading", level: 1, text: "Title" });
    expect(classifyBlock("### Deep")).toEqual({ kind: "heading", level: 3, text: "Deep" });
    // h4 and below share h3's box in the transcript stylesheet.
    expect(classifyBlock("##### Deeper")).toEqual({ kind: "heading", level: 3, text: "Deeper" });
  });

  test("counts fence lines without measuring them", () => {
    expect(classifyBlock("```ts\na\nb\nc\n```")).toEqual({
      kind: "code",
      lines: 3,
      maxLineLength: 1,
    });
  });

  test("counts an unterminated fence to the end of the block", () => {
    expect(classifyBlock("```\nstill streaming")).toEqual({
      kind: "code",
      lines: 1,
      maxLineLength: 15,
    });
  });

  test("recognises a list and its nesting depth", () => {
    const block = classifyBlock("- one\n- two\n  - nested");
    expect(block).toEqual({
      kind: "list",
      ordered: false,
      items: [
        { text: "one", depth: 0 },
        { text: "two", depth: 0 },
        { text: "nested", depth: 1 },
      ],
    });
  });

  test("folds a wrapped list item into the item above it", () => {
    const block = classifyBlock("- one\n  continued");
    expect(block).toEqual({
      kind: "list",
      ordered: false,
      items: [{ text: "one continued", depth: 0 }],
    });
  });

  test("recognises an ordered list", () => {
    expect(classifyBlock("1. one\n2. two")).toEqual({
      kind: "list",
      ordered: true,
      items: [
        { text: "one", depth: 0 },
        { text: "two", depth: 0 },
      ],
    });
  });

  test("recognises a blockquote", () => {
    expect(classifyBlock("> a\n> b")).toEqual({ kind: "quote", text: "a b" });
  });

  test("recognises a rule", () => {
    expect(classifyBlock("---")).toEqual({ kind: "rule" });
  });

  test("recognises a table and drops the delimiter row", () => {
    expect(classifyBlock("| a | b |\n| --- | --- |\n| 1 | 2 |")).toEqual({
      kind: "table",
      rows: [
        ["a", "b"],
        ["1", "2"],
      ],
    });
  });
});

describe("inline runs", () => {
  test("the fast path rejects every inline marker", () => {
    expect(RICH_INLINE_RE.test("plain words, punctuation! and 123.")).toBe(false);
    for (const marker of ["*", "_", "`", "~", "[", "<"]) {
      expect(RICH_INLINE_RE.test(`a${marker}b`)).toBe(true);
    }
  });

  test("splits bold, italic, code and links onto their own fonts", () => {
    const m = metrics();
    const runs = inlineRuns("a **b** _c_ `d` [e](http://x)", m.blocks.p, m);
    expect(runs.map((run) => run.font)).toEqual([
      m.blocks.p.font,
      m.inline.strong.font,
      m.blocks.p.font,
      m.inline.em.font,
      m.blocks.p.font,
      m.inline.code.font,
      m.blocks.p.font,
      m.inline.a.font,
    ]);
    expect(runs.map((run) => run.text)).toEqual(["a ", "b", " ", "c", " ", "d", " ", "e"]);
  });

  test("charges inline code its padding and a link its copy chrome", () => {
    const m = metrics();
    const runs = inlineRuns("`x` [y](http://z)", m.blocks.p, m);
    expect(runs[0].extraWidth).toBe(m.inline.code.extraWidth);
    expect(runs[runs.length - 1].extraWidth).toBe(LINK_CHROME_PX);
  });

  test("drops raw html tags and honours backslash escapes", () => {
    const m = metrics();
    expect(inlineRuns("<b>x</b>", m.blocks.p, m).map((run) => run.text)).toEqual(["x"]);
    expect(inlineRuns("a \\*not em\\* b", m.blocks.p, m).map((run) => run.text)).toEqual([
      "a *not em* b",
    ]);
  });

  test("leaves an unclosed marker as literal text", () => {
    const m = metrics();
    expect(inlineRuns("2 * 3 = 6", m.blocks.p, m).map((run) => run.text)).toEqual(["2 * 3 = 6"]);
  });
});

describe("block boxes", () => {
  test("a paragraph is its measured text plus its own margins", () => {
    const m = metrics();
    // 20 characters at 10px over a 100px column is two lines.
    expect(blockBox(classifyBlock("x".repeat(20)), m, 100, measurer)).toEqual({
      height: 40,
      marginTop: 7,
      marginBottom: 7,
    });
  });

  test("a code fence needs no measurement at all", () => {
    const m = metrics();
    const never: TextMeasurer = {
      plain() {
        throw new Error("a code fence must not be measured");
      },
      rich() {
        throw new Error("a code fence must not be measured");
      },
    };
    // Three lines of 17px, plus 10px padding top and bottom.
    expect(blockBox(classifyBlock("```\na\nb\nc\n```"), m, 100, never)).toEqual({
      height: 3 * 17 + 20,
      marginTop: 8,
      marginBottom: 8,
    });
  });

  test("a list subtracts its padding-left before measuring", () => {
    const m = metrics();
    // 9 characters at 10px is 90px: it fits a 100px column but not the 82px
    // that is left once the list indent is taken off.
    const single = blockBox(classifyBlock("- xxxxxxxxx"), m, 100, measurer);
    expect(single.height).toBe(40);
  });

  test("a nested item indents by one more level", () => {
    const m = metrics();
    const nested = blockBox(classifyBlock("  - xxxxxxx"), m, 100, measurer);
    // 70px of text against 100 - 18 - 18 = 64px of column is two lines.
    expect(nested.height).toBe(40);
  });

  test("list item margins collapse between siblings only", () => {
    const m = metrics();
    const two = blockBox(classifyBlock("- a\n- b"), m, 100, measurer);
    // Two 20px items with one collapsed 2px gap between them.
    expect(two.height).toBe(42);
    // The outer margin is the larger of the list's own and the first item's.
    expect(two.marginTop).toBe(6);
    expect(two.marginBottom).toBe(6);
  });

  test("a list item pays for its own padding", () => {
    const m = metrics();
    const padded = metrics({
      blocks: { ...metrics().blocks, li: box({ marginTop: 2, marginBottom: 2, paddingTop: 4, paddingBottom: 4 }) },
    });
    const plain = blockBox(classifyBlock("- a\n- b"), m, 100, measurer);
    const withPadding = blockBox(classifyBlock("- a\n- b"), padded, 100, measurer);
    expect(withPadding.height - plain.height).toBe(16);
  });

  test("a fence uses the rendered card, not the bare pre", () => {
    const m = metrics({
      codeBlock: {
        lineHeight: 18.5,
        chrome: 123,
        marginTop: 16,
        marginBottom: 16,
        charWidth: 6.6,
        scrollbar: 15,
        gutter: 76,
      },
    });
    expect(blockBox(classifyBlock("```\na\nb\n```"), m, 640, measurer)).toEqual({
      height: 2 * 18.5 + 123,
      marginTop: 16,
      marginBottom: 16,
    });
  });

  test("a fence with a line too long to fit pays for its scrollbar", () => {
    const m = metrics({
      codeBlock: {
        lineHeight: 18.5,
        chrome: 123,
        marginTop: 16,
        marginBottom: 16,
        charWidth: 10,
        scrollbar: 15,
        gutter: 40,
      },
    });
    // 60 characters at 10px against 100 - 40 = 60px of column: it overflows.
    const wide = blockBox(classifyBlock(`\`\`\`\n${"x".repeat(60)}\n\`\`\``), m, 100, measurer);
    const narrow = blockBox(classifyBlock("```\nx\n```"), m, 100, measurer);
    expect(wide.height - narrow.height).toBe(15);
  });

  test("a line carrying emphasis is charged the rich line delta once", () => {
    const plain = metrics();
    const rich = metrics({ richLine: 2 });
    const source = "a **b** c";
    const before = blockBox(classifyBlock(source), plain, 100, measurer);
    const after = blockBox(classifyBlock(source), rich, 100, measurer);
    expect(after.height - before.height).toBe(2);
    // Plain text never pays it.
    expect(
      blockBox(classifyBlock("plain words"), rich, 100, measurer).height,
    ).toBe(blockBox(classifyBlock("plain words"), plain, 100, measurer).height);
  });

  test("a rule is its border, not its margins", () => {
    const m = metrics();
    expect(blockBox(classifyBlock("---"), m, 100, measurer)).toEqual({
      height: 0.5,
      marginTop: 13,
      marginBottom: 13,
    });
  });

  test("a blockquote measures inside its border and padding", () => {
    const m = metrics();
    // 100 - 12 - 12 - 3 = 73px of column, so 8 characters is two lines. The
    // inner paragraph keeps its own 7px margins because the quote has padding
    // at both edges for them to stop against.
    const quote = blockBox(classifyBlock("> xxxxxxxx"), m, 100, measurer);
    expect(quote.height).toBe(40 + 4 + 14);
  });

  test("a table sums its rows and their cell padding", () => {
    const m = metrics();
    const table = blockBox(classifyBlock("| a | b |\n| - | - |\n| c | d |"), m, 100, measurer);
    // Two rows, each one 20px line plus 10px padding plus a 0.5px border.
    expect(table.height).toBe(2 * (20 + 10 + 0.5));
  });
});

describe("margin collapsing across blocks", () => {
  test("collapses adjacent margins and trims the outer pair", () => {
    const m = metrics();
    // Two paragraphs: 20 + 20 of content, with one collapsed 7px gap. The
    // first block's top margin and the last block's bottom margin are trimmed
    // to zero by the markdown root's own first/last-child rules.
    expect(markdownHeight(["a", "b"], m, 100, measurer)).toBe(20 + 7 + 20);
  });

  test("takes the larger of the two adjacent margins", () => {
    const m = metrics();
    // Paragraph bottom is 7, heading top is 9: the gap is 9, not 16.
    expect(markdownHeight(["a", "# b"], m, 100, measurer)).toBe(20 + 9 + 18);
  });

  test("a single block contributes no margin at all", () => {
    const m = metrics();
    expect(markdownHeight(["a"], m, 100, measurer)).toBe(20);
  });

  test("ignores blank blocks", () => {
    const m = metrics();
    expect(markdownHeight(["a", "   ", "b"], m, 100, measurer)).toBe(20 + 7 + 20);
  });

  test("an empty document has no height", () => {
    expect(markdownHeight([], metrics(), 100, measurer)).toBe(0);
  });
});

describe("media rows", () => {
  test("scales a wide image down to the card and adds the caption row", () => {
    // 800x400 into a 400px card halves to 200px tall.
    expect(mediaHeight(800, 400, 400)).toBe(200 + MEDIA_CARD_CHROME_PX);
  });

  test("never enlarges an image narrower than the card", () => {
    expect(mediaHeight(100, 50, 400)).toBe(50 + MEDIA_CARD_CHROME_PX);
  });

  test("clamps a tall image to the max height", () => {
    expect(mediaHeight(400, 4000, 400)).toBe(MEDIA_MAX_PX + MEDIA_CARD_CHROME_PX);
  });

  test("falls back when the artifact recorded no dimensions", () => {
    expect(mediaHeight(null, null, 400)).toBeGreaterThan(MEDIA_CARD_CHROME_PX);
  });
});

describe("message rows", () => {
  test("an interrupted turn is a constant", () => {
    const message: RowMessage = {
      role: "user",
      kind: "text",
      text: "[Request interrupted by user]",
    };
    expect(messageRowHeight(message, context())).toBe(INTERRUPTED_PX);
  });

  test("a thinking row is the collapsed trigger only", () => {
    const message: RowMessage = { kind: "thinking", text: "x".repeat(4000) };
    expect(messageRowHeight(message, context())).toBe(COLLAPSED_THINKING_PX);
  });

  test("a user bubble stops at the ten line clamp and gains a toggle", () => {
    const userMetrics = metrics({
      contentWidth: 100,
      root: box({ paddingTop: 8, paddingBottom: 8, borderTop: 1, borderBottom: 1 }),
    });
    const ctx = context({ user: userMetrics });
    const short: RowMessage = { role: "user", kind: "text", text: "x".repeat(10) };
    expect(messageRowHeight(short, ctx)).toBe(20 + 18);
    const long: RowMessage = { role: "user", kind: "text", text: "x".repeat(1000) };
    const clamp = USER_BUBBLE_CLAMP_LINES * userMetrics.blocks.p.lineHeight;
    expect(messageRowHeight(long, ctx)).toBe(clamp + USER_BUBBLE_TOGGLE_PX + 18);
  });

  test("an assistant turn is its markdown plus the root box", () => {
    const ctx = context();
    const message: RowMessage = { role: "assistant", kind: "text", text: "x".repeat(20) };
    expect(messageRowHeight(message, ctx)).toBe(40);
  });
});

describe("estimateRowHeight", () => {
  test("a tool group is the pill plus the row gap, whatever it contains", () => {
    const ctx = context();
    const one = estimateRowHeight(
      { type: "tools", key: "a", items: [{ kind: "tool_use", text: "Bash: ls" }] },
      ctx,
    );
    const many = estimateRowHeight(
      {
        type: "tools",
        key: "b",
        items: Array.from({ length: 40 }, () => ({ kind: "tool_use", text: "x".repeat(4000) })),
      },
      ctx,
    );
    expect(one).toBe(TOOL_PILL_PX + ROW_GAP_PX);
    // Expanding a group is a portalled popover, so the row never grows.
    expect(many).toBe(one);
  });

  test("a speaker change adds its wrapper padding", () => {
    const item = {
      type: "msg" as const,
      key: "a",
      message: { role: "assistant", kind: "text", text: "x".repeat(20) },
    };
    const plain = estimateRowHeight(item, context());
    const changed = estimateRowHeight(item, context({ speakerChanged: true }));
    expect(changed - plain).toBe(SPEAKER_CHANGE_PX);
  });

  test("always returns a positive integer", () => {
    const item = { type: "msg" as const, key: "a", message: { kind: "text", text: "" } };
    const height = estimateRowHeight(item, context());
    expect(Number.isInteger(height)).toBe(true);
    expect(height).toBeGreaterThan(0);
  });
});
