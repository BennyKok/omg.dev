/**
 * Predicted height of one chat transcript row.
 *
 * This module is the *model* half of the virtualized transcript. It is pure
 * arithmetic: no DOM, no canvas, no React. Everything that has to touch real
 * CSS or real font metrics is injected — the resolved box metrics come in as
 * a `MarkdownMetrics` value (see ./markdown-metrics) and every text
 * measurement goes through the `TextMeasurer` callback. That is what makes it
 * testable under `bun test` with no browser at all: the tests hand it a
 * deterministic fake measurer and assert the arithmetic, and a separate
 * fixture gate replays it against heights recorded from a real browser.
 *
 * The virtualizer only ever uses these numbers as *estimates*. Every row that
 * is actually mounted gets DOM-measured and the measured value wins. The model
 * exists so that the rows which are NOT mounted (the ~1200 above the fold)
 * contribute a believable offset instead of a flat guess.
 */

import type { ChatRenderItem, ChatRenderMessage } from "./chat-render-items";
import type { BoxMetrics, MarkdownMetrics } from "./markdown-metrics";
import { parseOmgPromptEnvelope } from "./omg-prompt-envelope";

// ---------------------------------------------------------------------------
// Constants
//
// These are rows whose height does not depend on their content at all, so
// measuring them buys nothing. Each one is the real CSS box, written out here
// rather than probed, because a constant that is wrong shows up immediately in
// the fixture gate and a probe for a fixed-height row is just a slower way of
// writing the same number.
// ---------------------------------------------------------------------------

/** ConversationContent's `gap-2`. Absolute positioning removes the flex gap,
 *  so each virtual row carries it as its own bottom padding instead. */
export const ROW_GAP_PX = 8;

/** The `pt-2.5` wrapper the chat loop adds on a speaker change. */
export const SPEAKER_CHANGE_PX = 10;

/** `.tool-call-row`: text-xs (16px line box) + `py-1`. */
export const TOOL_PILL_PX = 24;

/** "Interrupted" status line: text-[11px] over a 16px line box + `py-0.5`. */
export const INTERRUPTED_PX = 20;

/** A collapsed `Reasoning`: only the trigger row is in flow (text-xs). */
export const COLLAPSED_THINKING_PX = 16;

/** The typing dots. Rendered outside the virtual window; exported so the
 *  footer can reserve the same space the model would have predicted. */
export const TYPING_INDICATOR_PX = 28;

/** A native artifact embed is a live document with no knowable height until
 *  it renders. It is capped at 560px and is rare, so the estimate is a middle
 *  value; the row is DOM-measured the moment it enters the window. */
export const HTML_ARTIFACT_PX = 320;

/** Image/video card: 1px border top and bottom plus the caption row
 *  (text-xs line box + `py-2`). */
export const MEDIA_CARD_CHROME_PX = 34;

/** `max-h-[24rem]` on the media element itself. */
export const MEDIA_MAX_PX = 384;

/** File card: the icon/name/size/download row (`py-2` + text line box) plus
 *  the card's top and bottom border. A file artifact is never rendered inline,
 *  so unlike media this row has no variable body to account for. */
export const FILE_CARD_CHROME_PX = 42;

/** `-webkit-line-clamp: 10` on `.user-bubble-clamp` (index.css). */
export const USER_BUBBLE_CLAMP_LINES = 10;

/** "Show more" toggle under a clamped user bubble: 12px/1.2 + `mt-1`. */
export const USER_BUBBLE_TOGGLE_PX = 18;

/** The collapsed omg.dev instructions chip (30px) plus the `gap-1.5` (6px)
 * between it and the visible task bubble. The renderer removes the full
 * agent-facing contract from the bubble and draws this fixed chrome instead. */
export const OMG_INSTRUCTIONS_LEADING_PX = 36;

/** CopyableMarkdownLink appends an external-link glyph and a copy button to
 *  every rendered link, which occupy inline width the raw markdown does not. */
export const LINK_CHROME_PX = 38;

/** Extra vertical chrome a rendered code fence carries beyond `pre`'s own box
 *  (a language/copy header, when the code plugin draws one). */
export const CODE_BLOCK_CHROME_PX = 0;

/** Bumped whenever the arithmetic below changes in a way that invalidates a
 *  cached height. Combined with `MarkdownMetrics.metricsVersion` it forms the
 *  full cache key, so a model change and a CSS change both flush the cache. */
export const HEIGHT_MODEL_VERSION = 2;

/** One rendered line in a user bubble before the row gap. */
export const USER_SINGLE_LINE_PX = 42;

/** One rendered assistant line before the row gap. */
export const ASSISTANT_SINGLE_LINE_PX = 26;

// ---------------------------------------------------------------------------
// Injected measurement
// ---------------------------------------------------------------------------

/** One inline stretch of text that shares a single font. */
export type InlineRun = {
  text: string;
  font: string;
  letterSpacing?: number;
  /** Non-text width that rides along with this run (inline code padding, the
   *  link chrome above). */
  extraWidth?: number;
};

/**
 * The two shapes of text measurement the model needs. The real implementation
 * is pretext (`prepare`/`layout` and `prepareRichInline`); the tests pass a
 * deterministic stand-in.
 *
 * Both return a HEIGHT in CSS pixels, not a line count, so a measurer is free
 * to round line counts however the engine it models does.
 */
export type TextMeasurer = {
  plain(text: string, font: string, width: number, lineHeight: number, letterSpacing?: number): number;
  rich(runs: InlineRun[], width: number, lineHeight: number): number;
};

// ---------------------------------------------------------------------------
// Row model
// ---------------------------------------------------------------------------

/** The fields of a transcript message this model reads. Deliberately a subset
 *  of the app's `Message` so the module stays independent of it. */
export type RowMessage = ChatRenderMessage & {
  role?: string;
  url?: string | null;
  width?: number | null;
  height?: number | null;
  html?: string | null;
  caption?: string | null;
  name?: string | null;
  failed?: boolean;
  interrupted?: boolean;
};

export type RowContext = {
  /** Resolved CSS for an assistant markdown root at its real width. */
  assistant: MarkdownMetrics;
  /** Resolved CSS for a user bubble root. Falls back to `assistant`. */
  user?: MarkdownMetrics;
  measure: TextMeasurer;
  /** streamdown's own `parseMarkdownIntoBlocks`. Injected so this module does
   *  not import a React package, and so the model splits blocks with exactly
   *  the same splitter Streamdown renders with. */
  splitBlocks: (markdown: string) => string[];
  /** True when a speaker change puts the `pt-2.5` wrapper on this row. */
  speakerChanged?: boolean;
  /** Width available to a media card, before its own border. */
  mediaWidth?: number;
};

// ---------------------------------------------------------------------------
// Block classification
// ---------------------------------------------------------------------------

export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: { text: string; depth: number }[] }
  | { kind: "code"; lines: number; maxLineLength: number }
  | { kind: "quote"; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "rule" };

const FENCE_RE = /^\s{0,3}(?:`{3,}|~{3,})/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*)$/;
const RULE_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET_RE = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;

/**
 * Turn one block of markdown source into the shape whose height we can
 * compute. The input is a single block as produced by streamdown's
 * `parseMarkdownIntoBlocks`, so this never has to find block boundaries — only
 * to recognise which kind of block it was handed.
 */
export function classifyBlock(src: string): MarkdownBlock {
  const raw = src.replace(/\n+$/, "");
  if (!raw.trim()) return { kind: "paragraph", text: "" };
  const lines = raw.split("\n");

  if (FENCE_RE.test(lines[0])) {
    // `white-space: pre` on `.markdown pre` (index.css) means a fence never
    // wraps, so the line count IS the layout and no measurement is needed.
    let end = lines.length;
    for (let i = 1; i < lines.length; i += 1) {
      if (FENCE_RE.test(lines[i])) {
        end = i;
        break;
      }
    }
    let maxLineLength = 0;
    for (let i = 1; i < end; i += 1) {
      if (lines[i].length > maxLineLength) maxLineLength = lines[i].length;
    }
    return { kind: "code", lines: Math.max(1, end - 1), maxLineLength };
  }

  if (RULE_RE.test(lines[0]) && lines.length === 1) return { kind: "rule" };

  const heading = HEADING_RE.exec(lines[0]);
  if (heading) {
    const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
    return { kind: "heading", level, text: heading[2].trim() };
  }

  if (QUOTE_RE.test(lines[0])) {
    const text = lines.map((line) => QUOTE_RE.exec(line)?.[1] ?? line.trim()).join(" ");
    return { kind: "quote", text };
  }

  if (lines.length >= 2 && lines[0].trimStart().startsWith("|") && /^[\s|:-]+$/.test(lines[1])) {
    const rows = lines
      .filter((line, index) => index !== 1 && line.includes("|"))
      .map((line) =>
        line
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim()),
      );
    return { kind: "table", rows };
  }

  if (BULLET_RE.test(lines[0])) {
    const items: { text: string; depth: number }[] = [];
    for (const line of lines) {
      const bullet = BULLET_RE.exec(line);
      if (bullet) {
        items.push({ text: bullet[2], depth: Math.floor(bullet[1].length / 2) });
      } else if (items.length && line.trim()) {
        // A continuation line of the previous item.
        items[items.length - 1].text += ` ${line.trim()}`;
      }
    }
    if (items.length) {
      return { kind: "list", ordered: /^\s*\d/.test(lines[0]), items };
    }
  }

  // A soft line break inside a paragraph renders as a space, not a new line.
  return { kind: "paragraph", text: lines.join(" ") };
}

// ---------------------------------------------------------------------------
// Inline runs
// ---------------------------------------------------------------------------

/**
 * The fast-path test. A block containing none of these characters has no
 * inline markup at all, so it needs neither the tokenizer below nor pretext's
 * rich-inline path — a single `prepare()` + `layout()` covers it. Most of a
 * real transcript takes this path.
 */
export const RICH_INLINE_RE = /[*_`~[<]/;

type InlineFontKey = "base" | "strong" | "em" | "code" | "link";

function fontFor(key: InlineFontKey, metrics: MarkdownMetrics, base: BoxMetrics): string {
  switch (key) {
    case "strong":
      return metrics.inline.strong.font;
    case "em":
      return metrics.inline.em.font;
    case "code":
      return metrics.inline.code.font;
    case "link":
      return metrics.inline.a.font;
    default:
      return base.font;
  }
}

function extraFor(key: InlineFontKey, metrics: MarkdownMetrics): number {
  if (key === "code") return metrics.inline.code.extraWidth;
  if (key === "link") return LINK_CHROME_PX;
  return 0;
}

/**
 * Split inline markdown into runs of one font each.
 *
 * This is not a markdown parser and does not try to be: it recognises the
 * inline constructs that change the FONT (bold, italic, inline code, links)
 * plus the ones that change nothing but must not be drawn (strikethrough
 * markers, raw HTML tags, backslash escapes). Anything it does not recognise
 * stays literal text in the base font, which is the safe direction — it can
 * only make the model slightly wide, never structurally wrong.
 */
export function inlineRuns(text: string, base: BoxMetrics, metrics: MarkdownMetrics): InlineRun[] {
  const runs: InlineRun[] = [];
  let buffer = "";
  let bufferKey: InlineFontKey = "base";

  const flush = () => {
    if (!buffer) return;
    const last = runs[runs.length - 1];
    const font = fontFor(bufferKey, metrics, base);
    if (last && last.font === font && !extraFor(bufferKey, metrics)) {
      last.text += buffer;
    } else {
      runs.push({
        text: buffer,
        font,
        letterSpacing: base.letterSpacing,
        extraWidth: extraFor(bufferKey, metrics),
      });
    }
    buffer = "";
    bufferKey = "base";
  };

  const push = (value: string, key: InlineFontKey) => {
    if (!value) return;
    if (key !== bufferKey) flush();
    bufferKey = key;
    buffer += value;
    if (key !== "base") flush();
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "\\" && i + 1 < text.length) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      let ticks = 0;
      while (text[i + ticks] === "`") ticks += 1;
      const fence = "`".repeat(ticks);
      const close = text.indexOf(fence, i + ticks);
      if (close > 0) {
        push(text.slice(i + ticks, close), "code");
        i = close + ticks;
        continue;
      }
    }

    if ((ch === "*" || ch === "_") && text[i + 1] === ch) {
      const marker = ch + ch;
      const close = text.indexOf(marker, i + 2);
      if (close > 0) {
        push(text.slice(i + 2, close), "strong");
        i = close + 2;
        continue;
      }
    }

    if (ch === "*" || ch === "_") {
      const close = text.indexOf(ch, i + 1);
      if (close > 0 && close !== i + 1) {
        push(text.slice(i + 1, close), "em");
        i = close + 1;
        continue;
      }
    }

    if (ch === "~" && text[i + 1] === "~") {
      const close = text.indexOf("~~", i + 2);
      if (close > 0) {
        // Strikethrough does not change the font, only the decoration.
        push(text.slice(i + 2, close), "base");
        i = close + 2;
        continue;
      }
    }

    if (ch === "!" && text[i + 1] === "[") {
      const closeLabel = text.indexOf("]", i + 2);
      if (closeLabel > 0 && text[closeLabel + 1] === "(") {
        const closeUrl = text.indexOf(")", closeLabel + 2);
        if (closeUrl > 0) {
          // An inline image contributes no text run; its box is handled by the
          // media row path when it is a block of its own.
          i = closeUrl + 1;
          continue;
        }
      }
    }

    if (ch === "[") {
      const closeLabel = text.indexOf("]", i + 1);
      if (closeLabel > 0 && text[closeLabel + 1] === "(") {
        const closeUrl = text.indexOf(")", closeLabel + 2);
        if (closeUrl > 0) {
          push(text.slice(i + 1, closeLabel), "link");
          i = closeUrl + 1;
          continue;
        }
      }
    }

    if (ch === "<") {
      const close = text.indexOf(">", i + 1);
      if (close > 0 && /^<\/?[a-zA-Z][^<>]*>$/.test(text.slice(i, close + 1))) {
        i = close + 1;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }
  flush();
  return runs;
}

function measureInline(
  text: string,
  box: BoxMetrics,
  metrics: MarkdownMetrics,
  width: number,
  measure: TextMeasurer,
): number {
  if (!text) return box.lineHeight;
  const usable = Math.max(1, width);
  if (!RICH_INLINE_RE.test(text)) {
    return measure.plain(text, box.font, usable, box.lineHeight, box.letterSpacing);
  }
  const runs = inlineRuns(text, box, metrics);
  if (!runs.length) return box.lineHeight;
  if (runs.length === 1 && !runs[0].extraWidth) {
    return measure.plain(runs[0].text, runs[0].font, usable, box.lineHeight, box.letterSpacing);
  }
  const height = measure.rich(runs, usable, box.lineHeight);
  // A line that carries a span with its own face is a little taller than the
  // strut. Which lines those are is not knowable from a line COUNT, so the
  // charge is one line per block: in this corpus a rich block usually keeps
  // its emphasis on a single line, and charging every line would be further
  // out than under-charging the few that carry two.
  if (metrics.richLine > 0 && runs.some((run) => run.font !== box.font)) {
    return height + metrics.richLine;
  }
  return height;
}

// ---------------------------------------------------------------------------
// Block heights
// ---------------------------------------------------------------------------

export type BlockBox = { height: number; marginTop: number; marginBottom: number };

function boxOuter(box: BoxMetrics): number {
  return box.paddingTop + box.paddingBottom + box.borderTop + box.borderBottom;
}

function headingBox(level: 1 | 2 | 3, metrics: MarkdownMetrics): BoxMetrics {
  return level === 1 ? metrics.blocks.h1 : level === 2 ? metrics.blocks.h2 : metrics.blocks.h3;
}

/** Height and outer margins of a single markdown block at a given width. */
export function blockBox(
  block: MarkdownBlock,
  metrics: MarkdownMetrics,
  width: number,
  measure: TextMeasurer,
): BlockBox {
  switch (block.kind) {
    case "heading": {
      const box = headingBox(block.level, metrics);
      return {
        height: measureInline(block.text, box, metrics, width, measure) + boxOuter(box),
        marginTop: box.marginTop,
        marginBottom: box.marginBottom,
      };
    }
    case "paragraph": {
      const box = metrics.blocks.p;
      return {
        height: measureInline(block.text, box, metrics, width, measure) + boxOuter(box),
        marginTop: box.marginTop,
        marginBottom: box.marginBottom,
      };
    }
    case "code": {
      // Streamdown draws a fence as a card, not as the bare `pre` the
      // stylesheet describes: a language header, a sticky copy bar with a
      // negative top margin, flex gaps, a border and padding. Those come from
      // a real rendered fence (MarkdownMetrics.codeBlock). Until one has been
      // rendered in this container the bare `pre` box is the best available
      // answer, and it is low by the card chrome.
      const card = metrics.codeBlock;
      if (card) {
        // A fence does not wrap, so a long line puts a horizontal scrollbar
        // under it. Whether that scrollbar takes vertical space is a platform
        // question (it does on this Linux Chromium, it does not with overlay
        // scrollbars), so both the bar height and the monospace advance come
        // from the real rendered fence. The comparison is exact rather than
        // measured: the font is monospace, so a character count IS a width.
        const inner = Math.max(1, width - card.gutter);
        const overflows = card.charWidth > 0 && block.maxLineLength * card.charWidth > inner;
        return {
          height:
            block.lines * card.lineHeight + card.chrome + (overflows ? card.scrollbar : 0),
          marginTop: card.marginTop,
          marginBottom: card.marginBottom,
        };
      }
      const box = metrics.blocks.pre;
      return {
        height: block.lines * box.lineHeight + boxOuter(box) + CODE_BLOCK_CHROME_PX,
        marginTop: box.marginTop,
        marginBottom: box.marginBottom,
      };
    }
    case "rule": {
      const box = metrics.blocks.hr;
      return {
        height: box.borderTop + box.borderBottom,
        marginTop: box.marginTop,
        marginBottom: box.marginBottom,
      };
    }
    case "quote": {
      const box = metrics.blocks.blockquote;
      const paragraph = metrics.blocks.p;
      const inner = Math.max(1, width - box.paddingLeft - box.paddingRight - box.borderLeft);
      const text = measureInline(block.text, paragraph, metrics, inner, measure);
      // The quote holds a real paragraph, and that paragraph keeps its own
      // margins: the root's first/last-child trim reaches direct children of
      // the markdown root only. The margins escape by collapsing through the
      // quote when it has nothing at that edge to stop them.
      const top = box.paddingTop > 0 || box.borderTop > 0 ? paragraph.marginTop : 0;
      const bottom = box.paddingBottom > 0 || box.borderBottom > 0 ? paragraph.marginBottom : 0;
      return {
        height:
          text +
          top +
          bottom +
          box.paddingTop +
          box.paddingBottom +
          box.borderTop +
          box.borderBottom,
        marginTop: Math.max(box.marginTop, top ? 0 : paragraph.marginTop),
        marginBottom: Math.max(box.marginBottom, bottom ? 0 : paragraph.marginBottom),
      };
    }
    case "list": {
      const list = block.ordered ? metrics.blocks.ol : metrics.blocks.ul;
      const li = metrics.blocks.li;
      // A nested level indents by the same padding-left again.
      // Each item carries its own padding and border. Streamdown puts `py-1`
      // on a list item, which the stylesheet alone does not show.
      const itemBox = li.paddingTop + li.paddingBottom + li.borderTop + li.borderBottom;
      let total = 0;
      for (const item of block.items) {
        const inner = Math.max(1, width - list.paddingLeft * (item.depth + 1));
        total += measureInline(item.text, li, metrics, inner, measure) + itemBox;
      }
      // Adjacent li margins collapse with each other. The first item's top and
      // the last item's bottom collapse OUT through the ul (which has no
      // vertical border or padding), so they are already covered by the list's
      // own margins below and must not be added here.
      const between = Math.max(li.marginTop, li.marginBottom) * Math.max(0, block.items.length - 1);
      return {
        height: total + between + list.paddingTop + list.paddingBottom,
        marginTop: Math.max(list.marginTop, li.marginTop),
        marginBottom: Math.max(list.marginBottom, li.marginBottom),
      };
    }
    case "table": {
      const table = metrics.blocks.table;
      const cell = metrics.blocks.td;
      const head = metrics.blocks.th;
      const columns = Math.max(1, ...block.rows.map((row) => row.length));
      const columnWidth = Math.max(
        1,
        width / columns - cell.paddingLeft - cell.paddingRight,
      );
      let total = table.paddingTop + table.paddingBottom;
      block.rows.forEach((row, index) => {
        const box = index === 0 ? head : cell;
        let tallest = box.lineHeight;
        for (const text of row) {
          tallest = Math.max(tallest, measureInline(text, box, metrics, columnWidth, measure));
        }
        total += tallest + box.paddingTop + box.paddingBottom + box.borderTop + box.borderBottom;
      });
      return { height: total, marginTop: table.marginTop, marginBottom: table.marginBottom };
    }
  }
}

/**
 * Sum a markdown root's blocks with CSS margin collapsing.
 *
 *   total = sum(h_i) + sum(max(marginBottom_i, marginTop_{i+1}))
 *
 * The first block's top margin and the last block's bottom margin are trimmed
 * to zero, which is exactly what `[&>*:first-child]:mt-0 [&>*:last-child]:mb-0`
 * on the Streamdown root does (streamdown-response.tsx).
 *
 * Row-to-row margins never collapse: every row is a flex item of
 * `flex flex-col gap-2`, and flex items do not collapse margins with anything.
 * Collapsing only ever happens INSIDE one markdown root, which is why it is
 * handled here and nowhere else.
 */
export function markdownHeight(
  blocks: string[],
  metrics: MarkdownMetrics,
  width: number,
  measure: TextMeasurer,
): number {
  const boxes = blocks
    .filter((block) => block.trim().length > 0)
    .map((block) => blockBox(classifyBlock(block), metrics, width, measure));
  if (!boxes.length) return 0;
  let total = 0;
  for (let i = 0; i < boxes.length; i += 1) {
    total += boxes[i].height;
    if (i < boxes.length - 1) {
      total += Math.max(boxes[i].marginBottom, boxes[i + 1].marginTop);
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/**
 * An image or video row. `message.width`/`message.height` are recorded when
 * the artifact is published, so this row is arithmetic rather than a guess:
 * the media is `w-auto max-w-full max-h-[24rem] object-contain` inside a card
 * capped at `min(34rem, 92vw)`.
 */
export function mediaHeight(
  intrinsicWidth: number | null | undefined,
  intrinsicHeight: number | null | undefined,
  cardWidth: number,
): number {
  const inner = Math.max(1, cardWidth);
  if (!intrinsicWidth || !intrinsicHeight || intrinsicWidth <= 0 || intrinsicHeight <= 0) {
    return Math.round(MEDIA_MAX_PX * 0.6) + MEDIA_CARD_CHROME_PX;
  }
  const scale = Math.min(1, inner / intrinsicWidth);
  const drawn = Math.min(MEDIA_MAX_PX, intrinsicHeight * scale);
  return drawn + MEDIA_CARD_CHROME_PX;
}

/**
 * A file row: a fixed name/size/download strip, plus a caption row when the
 * caption says something the file name does not.
 */
export function fileHeight(hasCaption: boolean): number {
  return FILE_CARD_CHROME_PX + (hasCaption ? MEDIA_CARD_CHROME_PX : 0);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function isInterrupted(message: RowMessage): boolean {
  if (message.interrupted) return true;
  const text = message.text ?? "";
  return message.role === "user" && /\[Request interrupted by user\]/.test(text);
}

/** The height of one message row, without the row gap or speaker-change gap. */
export function messageRowHeight(message: RowMessage, ctx: RowContext): number {
  if (isInterrupted(message)) return INTERRUPTED_PX;
  if (message.kind === "thinking") return COLLAPSED_THINKING_PX;
  if (message.kind === "html") return HTML_ARTIFACT_PX;
  if (message.kind === "image" || message.kind === "video") {
    const cardWidth = ctx.mediaWidth ?? ctx.assistant.contentWidth;
    return mediaHeight(message.width, message.height, cardWidth);
  }
  if (message.kind === "file") {
    const caption = message.caption || message.text;
    return fileHeight(Boolean(caption && caption !== message.name));
  }

  const rawText = message.text ?? "";
  const envelope = message.role === "user" ? parseOmgPromptEnvelope(rawText) : null;
  const text = envelope?.task ?? rawText;
  const leading = envelope ? OMG_INSTRUCTIONS_LEADING_PX : 0;
  if (!text.trim()) return TYPING_INDICATOR_PX;

  if (message.role === "user") {
    const metrics = ctx.user ?? ctx.assistant;
    const box = metrics.blocks.p;
    const body = markdownHeight(ctx.splitBlocks(text), metrics, metrics.contentWidth, ctx.measure);
    // `-webkit-line-clamp: 10` caps the body; the "Show more" toggle only
    // appears once the clamp actually hides something.
    const clamp = USER_BUBBLE_CLAMP_LINES * box.lineHeight;
    const clamped = Math.min(body, clamp);
    const toggle = body > clamp + 1 ? USER_BUBBLE_TOGGLE_PX : 0;
    return (
      leading +
      clamped +
      toggle +
      metrics.root.paddingTop +
      metrics.root.paddingBottom +
      metrics.root.borderTop +
      metrics.root.borderBottom
    );
  }

  const metrics = ctx.assistant;
  const body = markdownHeight(ctx.splitBlocks(text), metrics, metrics.contentWidth, ctx.measure);
  return body + metrics.root.paddingTop + metrics.root.paddingBottom +
    metrics.root.borderTop + metrics.root.borderBottom;
}

/**
 * The height the virtualizer should reserve for one render item, including the
 * row gap it carries as its own bottom padding and the speaker-change gap.
 *
 * Expanding a tool group costs nothing here on purpose: the details are a
 * portalled Popover on desktop and a Vaul Drawer on mobile, neither of which
 * is in flow. The only row that grows in place is an opened thinking
 * Collapsible, and that row is mounted when it is opened, so the DOM
 * measurement takes over before the estimate can be wrong on screen.
 */
export function estimateRowHeight<T extends RowMessage>(
  item: ChatRenderItem<T>,
  ctx: RowContext,
): number {
  let height: number;
  if (item.type === "tools") {
    height = TOOL_PILL_PX;
  } else if (item.type === "artifact_tool") {
    height = messageRowHeight(item.message, ctx);
  } else {
    height = messageRowHeight(item.message, ctx);
  }
  return Math.max(1, Math.round(height + ROW_GAP_PX + (ctx.speakerChanged ? SPEAKER_CHANGE_PX : 0)));
}

/**
 * Conservative estimate used only before the CSS probe and markdown splitter
 * are ready. Most transcript rows are one-line prose, collapsed thinking, or
 * tool pills. Treating all of them as 64px made the first total systematically
 * too large. Fixed row shapes are known without font metrics. Prose starts at
 * one real line and can grow after the full model arrives.
 */
export function estimateUnprobedRowHeight<T extends RowMessage>(
  item: ChatRenderItem<T>,
  speakerChanged = false,
): number {
  let height: number;
  if (item.type === "tools") {
    height = TOOL_PILL_PX;
  } else {
    const message = item.message;
    const envelope =
      message.role === "user" ? parseOmgPromptEnvelope(message.text ?? "") : null;
    if (isInterrupted(message)) height = INTERRUPTED_PX;
    else if (message.kind === "thinking") height = COLLAPSED_THINKING_PX;
    else if (message.kind === "html") height = HTML_ARTIFACT_PX;
    else if (message.kind === "image" || message.kind === "video") {
      height = mediaHeight(message.width, message.height, 1);
    } else if (message.role === "user") {
      height = USER_SINGLE_LINE_PX + (envelope ? OMG_INSTRUCTIONS_LEADING_PX : 0);
    } else height = ASSISTANT_SINGLE_LINE_PX;
  }
  return Math.max(1, Math.round(height + ROW_GAP_PX + (speakerChanged ? SPEAKER_CHANGE_PX : 0)));
}
