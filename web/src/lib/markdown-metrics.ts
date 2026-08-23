/**
 * Real CSS, probed once, for the chat transcript's markdown rows.
 *
 * The height model (./chat-row-height) is pure arithmetic over box metrics. It
 * cannot guess those metrics, and hard-coding them would be wrong within a
 * release: transcript type sizes are counter-intuitive (a heading inside a
 * bubble is 14px against 17px body text — index.css), they change with the
 * theme, and they change again when a webfont finishes loading. So the metrics
 * are read from getComputedStyle on a hidden probe that is mounted INSIDE the
 * real transcript container, where it inherits the same theme, the same
 * cascade, and the same width as the rows it stands for.
 *
 * The store is a module-level singleton keyed by row class and width. Up to
 * four transcripts mount at once (MAX_COLUMNS = 4) and they share a stylesheet,
 * so probing per component would do the same layout work four times and would
 * also mean four caches to invalidate.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { layout, prepare } from "@chenglou/pretext";
import { measureRichInlineStats, prepareRichInline } from "@chenglou/pretext/rich-inline";

import type { InlineRun, TextMeasurer } from "./chat-row-height";

export type BoxMetrics = {
  /** A canvas font string, COMPOSED from the individual longhands. The `font`
   *  shorthand is not read: browsers do not serialize it reliably (Chromium
   *  returns an empty string whenever any longhand is not expressible in the
   *  shorthand, which is the normal case once a font stack is inherited). */
  font: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  marginTop: number;
  marginBottom: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  borderTop: number;
  borderBottom: number;
  borderLeft: number;
};

export type InlineMetrics = {
  font: string;
  letterSpacing: number;
  /** Horizontal box the glyphs do not pay for (inline `code` padding). */
  extraWidth: number;
};

export type BlockTag =
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "ul"
  | "ol"
  | "li"
  | "pre"
  | "blockquote"
  | "table"
  | "th"
  | "td"
  | "hr";
export type InlineTag = "strong" | "em" | "a" | "code";

/**
 * A rendered code fence, which is NOT the `pre` the stylesheet describes.
 * Streamdown wraps a fence in its own card: a language header, a sticky copy
 * bar with a negative top margin, flex gaps, a border and padding. None of
 * that is reachable from a synthetic probe, because the classes belong to
 * streamdown and change with it, so it is measured off a real rendered fence
 * instead.
 */
export type CodeBlockMetrics = {
  lineHeight: number;
  /** Everything in the card that is not a line of code, as one number. */
  chrome: number;
  marginTop: number;
  marginBottom: number;
  /** Advance width of one monospace character in the fence. A fence never
   *  wraps, so this turns a line length into a width with no measurement. */
  charWidth: number;
  /** Vertical space the horizontal scrollbar takes when a line overflows.
   *  Zero on a platform with overlay scrollbars. */
  scrollbar: number;
  /** Card width minus the code's own content width. */
  gutter: number;
};

export type MarkdownMetrics = {
  /** Stamped on every snapshot. Any cached height computed against an older
   *  version is stale and must be discarded. */
  metricsVersion: number;
  rowClass: string;
  contentWidth: number;
  root: BoxMetrics;
  blocks: Record<BlockTag, BoxMetrics>;
  inline: Record<InlineTag, InlineMetrics>;
  /**
   * How much taller a line box gets when an inline span with its own face
   * (bold, italic, code) sits on it. The union of that span's inline box with
   * the paragraph's strut is taller than the strut alone. It is about 2px
   * here, which is invisible on one line and adds up over a long reply, so it
   * is measured rather than ignored.
   */
  richLine: number;
  /** Null until a real fence has been rendered somewhere in this container. */
  codeBlock: CodeBlockMetrics | null;
};

export const ASSISTANT_ROW_CLASS = "markdown msg-text size-full";
export const USER_ROW_CLASS = "msg-text markdown user-bubble text-base";

/** Where a rendered example of each row class lives in the transcript. */
export const ASSISTANT_ROOT_SELECTOR = ".msg-text.markdown:not(.user-bubble)";
export const USER_ROOT_SELECTOR = ".user-bubble.markdown";

// ---------------------------------------------------------------------------
// Reading computed style
// ---------------------------------------------------------------------------

function px(value: string | null | undefined): number {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
}

/**
 * `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}` — the exact order the
 * CSS font shorthand grammar wants, built from longhands so it is always
 * populated. `fontSize` already carries its unit.
 */
export function composeFont(style: CSSStyleDeclaration): string {
  const fontStyle = style.fontStyle || "normal";
  const fontWeight = style.fontWeight || "400";
  const fontSize = style.fontSize || "16px";
  const fontFamily = style.fontFamily || "sans-serif";
  return `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
}

/**
 * `line-height: normal` has no computed pixel value to read — Chromium hands
 * back the literal string. Fall back to the ratio browsers use for a typical
 * Latin face rather than letting `parseFloat` produce NaN and poison every
 * height downstream.
 */
export function resolveLineHeight(raw: string | null | undefined, fontSize: number): number {
  if (!raw || raw === "normal") return fontSize * 1.2;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return fontSize * 1.2;
  return n;
}

function boxMetrics(el: Element): BoxMetrics {
  const style = getComputedStyle(el);
  const fontSize = px(style.fontSize) || 16;
  return {
    font: composeFont(style),
    fontSize,
    lineHeight: resolveLineHeight(style.lineHeight, fontSize),
    letterSpacing: style.letterSpacing === "normal" ? 0 : px(style.letterSpacing),
    marginTop: px(style.marginTop),
    marginBottom: px(style.marginBottom),
    paddingTop: px(style.paddingTop),
    paddingBottom: px(style.paddingBottom),
    paddingLeft: px(style.paddingLeft),
    paddingRight: px(style.paddingRight),
    borderTop: px(style.borderTopWidth),
    borderBottom: px(style.borderBottomWidth),
    borderLeft: px(style.borderLeftWidth),
  };
}

function inlineMetrics(el: Element, extraWidth = 0): InlineMetrics {
  const style = getComputedStyle(el);
  return {
    font: composeFont(style),
    letterSpacing: style.letterSpacing === "normal" ? 0 : px(style.letterSpacing),
    extraWidth: extraWidth || px(style.paddingLeft) + px(style.paddingRight),
  };
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

// The two bare divs are not decoration. The markdown root trims the first
// child's top margin and the last child's bottom margin
// (`[&>*:first-child]:mt-0 [&>*:last-child]:mb-0`), so a probe element sitting
// at either end would report a margin of zero and quietly lose it from every
// height that uses it.
const PROBE_MARKUP = `
<div data-probe="edge"></div>
<p data-probe="p">probe<strong data-probe="strong">b</strong><em data-probe="em">i</em><code data-probe="code">c</code><a data-probe="a" href="#">l</a></p>
<h1 data-probe="h1">probe</h1>
<h2 data-probe="h2">probe</h2>
<h3 data-probe="h3">probe</h3>
<ul data-probe="ul"><li data-probe="li">probe</li><li>probe</li></ul>
<ol data-probe="ol"><li>probe</li><li>probe</li></ol>
<pre data-probe="pre"><code>probe</code></pre>
<blockquote data-probe="blockquote"><p>probe</p></blockquote>
<table data-probe="table"><thead><tr><th data-probe="th">probe</th></tr></thead><tbody><tr><td data-probe="td">probe</td></tr></tbody></table>
<hr data-probe="hr" />
<p data-probe="plain-line">probe</p>
<p data-probe="rich-line">probe<strong>probe</strong><code>probe</code></p>
<div data-probe="edge"></div>
`;

/**
 * Where to find a real rendered example of each block tag.
 *
 * The synthetic probe above sees only the stylesheet. Streamdown renders every
 * element with its own Tailwind classes on top of it, and a Tailwind utility
 * beats an `@layer components` rule regardless of selector specificity — so a
 * bare `<h2>` reports a 17.5px line box where the real one lays out at 32px.
 * Reading the real element is the only way to see that, and it is the same
 * reasoning that makes content width come off a rendered row.
 *
 * `:not(:first-child):not(:last-child)` for anything that is a direct child of
 * the root, for the margin-trimming reason above.
 */
const HARVEST_SELECTORS: Record<BlockTag, string | null> = {
  p: "> p:not(:first-child):not(:last-child)",
  h1: "> h1:not(:first-child):not(:last-child)",
  h2: "> h2:not(:first-child):not(:last-child)",
  h3: "> h3:not(:first-child):not(:last-child)",
  ul: "> ul:not(:first-child):not(:last-child)",
  ol: "> ol:not(:first-child):not(:last-child)",
  li: "> ul > li, > ol > li",
  // A fence is a streamdown card, not a `pre`. See codeBlockMetricsFrom.
  pre: null,
  blockquote: "> blockquote:not(:first-child):not(:last-child)",
  table: "table",
  th: "th",
  td: "td",
  hr: "> hr:not(:first-child):not(:last-child)",
};

function harvestFrom(container: HTMLElement, rootSelector: string, tag: BlockTag): Element | null {
  const selector = HARVEST_SELECTORS[tag];
  if (!selector) return null;
  const parts = selector.split(",").map((part) => `${rootSelector} ${part.trim()}`);
  return container.querySelector(parts.join(", "));
}

/** Which tags currently have a real sample. Part of the cache key, so a
 *  snapshot taken before a heading was ever on screen is replaced once one is. */
function harvestSignature(container: HTMLElement, rootSelector: string): string {
  let signature = "";
  for (const tag of Object.keys(HARVEST_SELECTORS) as BlockTag[]) {
    signature += harvestFrom(container, rootSelector, tag) ? "1" : "0";
  }
  return signature;
}

export const CODE_BLOCK_SELECTOR = '[data-streamdown="code-block"]';

/**
 * Measure a rendered code fence.
 *
 * Streamdown puts `content-visibility: auto` with a 200px intrinsic size on
 * the card, so a fence that is outside the viewport reports the placeholder
 * height and its `pre` has no boxes at all. A zero-height `pre` is therefore
 * the signal that this sample is skipped, not that the code is empty.
 */
/**
 * Vertical space a horizontal scrollbar occupies. Measured on a throwaway box
 * rather than on the fence itself, because the fence in front of us may not be
 * overflowing, and the answer is a platform property rather than a per-fence
 * one. Zero wherever scrollbars are overlays (macOS, iOS, Android).
 */
function scrollbarThickness(doc: Document): number {
  const box = doc.createElement("div");
  box.style.cssText =
    "position:absolute;top:0;left:-99999px;width:100px;height:100px;overflow-x:scroll;visibility:hidden;";
  doc.body.appendChild(box);
  const thickness = box.offsetHeight - box.clientHeight;
  box.remove();
  return thickness;
}

/**
 * How many lines of code a rendered fence holds.
 *
 * A syntax highlighter emits one element per line and no newline characters at
 * all, so counting `\n` in textContent returns 1 for a twenty line fence.
 * Count the line elements first and fall back to the text only for a fence
 * that was never highlighted.
 */
function countCodeLines(code: Element): number {
  const marked = code.querySelectorAll(".line").length;
  if (marked > 0) return marked;
  let blocks = 0;
  for (const child of Array.from(code.children)) {
    if (getComputedStyle(child).display !== "inline") blocks += 1;
  }
  if (blocks > 0) return blocks;
  return (code.textContent ?? "").replace(/\n+$/, "").split("\n").length;
}

/** One character of the fence's own monospace face, measured in the fence. */
function monospaceAdvance(pre: Element): number {
  const doc = pre.ownerDocument;
  const ruler = doc.createElement("span");
  ruler.style.cssText = "position:absolute;visibility:hidden;white-space:pre;";
  ruler.textContent = "0".repeat(100);
  pre.appendChild(ruler);
  const width = ruler.getBoundingClientRect().width / 100;
  ruler.remove();
  return width;
}

export function codeBlockMetricsFrom(container: HTMLElement): CodeBlockMetrics | null {
  const cards = container.querySelectorAll<HTMLElement>(CODE_BLOCK_SELECTOR);
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    const pre = card.querySelector("pre");
    const code = pre?.querySelector("code") ?? pre;
    if (!pre || !code) continue;
    const codeHeight = code.getBoundingClientRect().height;
    if (codeHeight <= 0) continue;
    // The line height is derived from the rendered code rather than read off
    // `pre`, because the highlighter emits its own line boxes: on this
    // stylesheet the computed `pre` line-height is 15.71px while the code
    // really lays out at 18.56px per line. Two lines are needed for the
    // division to mean anything.
    const lines = countCodeLines(code);
    if (lines < 2) continue;
    const cardHeight = card.getBoundingClientRect().height;
    if (cardHeight <= codeHeight) continue;
    const preStyle = getComputedStyle(pre);
    const cardStyle = getComputedStyle(card);
    const innerWidth = Math.max(
      0,
      pre.clientWidth - px(preStyle.paddingLeft) - px(preStyle.paddingRight),
    );
    return {
      lineHeight: codeHeight / lines,
      // Everything that is not a line of code: the card border and padding,
      // the language header, the sticky copy bar, the flex gaps and `pre`'s
      // own padding. Taken as one number so it cannot be double counted.
      chrome: cardHeight - codeHeight,
      marginTop: px(cardStyle.marginTop),
      marginBottom: px(cardStyle.marginBottom),
      charWidth: monospaceAdvance(pre),
      scrollbar:
        pre.scrollWidth > pre.clientWidth
          ? Math.max(0, pre.offsetHeight - pre.clientHeight)
          : scrollbarThickness(pre.ownerDocument),
      gutter: Math.max(0, card.getBoundingClientRect().width - innerWidth),
    };
  }
  return null;
}

function probeMetrics(
  container: HTMLElement,
  rowClass: string,
  rootSelector: string,
  contentWidth: number,
  metricsVersion: number,
): MarkdownMetrics | null {
  const host = container.ownerDocument.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.dataset.markdownProbe = "1";
  // Out of flow and out of the a11y tree, but still a descendant of the real
  // container, so every inherited custom property, theme class and font stack
  // resolves exactly as it does for a real row. `contain: layout style` keeps
  // the probe's own layout from dirtying the transcript around it.
  host.style.cssText =
    "position:absolute;top:0;left:-99999px;visibility:hidden;pointer-events:none;contain:layout style;";
  host.style.width = `${contentWidth}px`;

  const root = container.ownerDocument.createElement("div");
  root.className = rowClass;
  root.style.width = `${contentWidth}px`;
  root.innerHTML = PROBE_MARKUP;
  host.appendChild(root);
  container.appendChild(host);

  try {
    const find = (name: string): Element | null => root.querySelector(`[data-probe="${name}"]`);
    // A real rendered element wins over the synthetic one, because only the
    // real one carries streamdown's own classes.
    const need = (name: BlockTag): BoxMetrics | null => {
      const real = harvestFrom(container, rootSelector, name);
      if (real) return boxMetrics(real);
      const el = find(name);
      return el ? boxMetrics(el) : null;
    };
    const p = need("p");
    const h1 = need("h1");
    const h2 = need("h2");
    const h3 = need("h3");
    const ul = need("ul");
    const ol = need("ol");
    const li = need("li");
    const pre = need("pre");
    const blockquote = need("blockquote");
    const table = need("table");
    const th = need("th");
    const td = need("td");
    const hr = need("hr");
    // Inline faces get the same treatment as the block boxes: a real rendered
    // `strong` or `code` carries streamdown's classes, the synthetic one does
    // not. For inline `code` the real element is also CLONED into the probe
    // paragraph, because the only way to see how much taller it makes a line
    // box is to lay one out.
    const inlineReal = (tag: string): Element | null =>
      container.querySelector(`${rootSelector} p ${tag}, ${rootSelector} li ${tag}`);
    const strong = inlineReal("strong") ?? find("strong");
    const em = inlineReal("em") ?? find("em");
    const a = inlineReal("a") ?? find("a");
    const realCode = inlineReal("code");
    const code = realCode ?? find("code");
    const richLineProbe = find("rich-line");
    if (richLineProbe) {
      const parts: Node[] = [container.ownerDocument.createTextNode("probe")];
      for (const source of [strong, realCode]) {
        if (!source) continue;
        const clone = source.cloneNode(false) as HTMLElement;
        clone.textContent = "probe";
        parts.push(clone);
      }
      if (parts.length > 1) richLineProbe.replaceChildren(...parts);
    }
    if (
      !p || !h1 || !h2 || !h3 || !ul || !ol || !li || !pre || !blockquote || !table || !th || !td ||
      !hr
    ) {
      return null;
    }
    if (!strong || !em || !code || !a) return null;
    return {
      metricsVersion,
      rowClass,
      contentWidth,
      root: boxMetrics(root),
      blocks: { p, h1, h2, h3, ul, ol, li, pre, blockquote, table, th, td, hr },
      inline: {
        strong: inlineMetrics(strong, 0),
        em: inlineMetrics(em, 0),
        a: inlineMetrics(a, 0),
        code: inlineMetrics(code),
      },
      richLine: Math.max(
        0,
        (find("rich-line")?.getBoundingClientRect().height ?? 0) -
          (find("plain-line")?.getBoundingClientRect().height ?? 0),
      ),
      codeBlock: codeBlockMetricsFrom(container),
    };
  } finally {
    host.remove();
  }
}

// ---------------------------------------------------------------------------
// The singleton store
// ---------------------------------------------------------------------------

let metricsVersion = 1;
const cache = new Map<string, MarkdownMetrics>();
const listeners = new Set<() => void>();
let watchersInstalled = false;

function cacheKey(rowClass: string, contentWidth: number, signature: string): string {
  return `${rowClass}|${Math.round(contentWidth)}|${signature}`;
}

export function markdownMetricsVersion(): number {
  return metricsVersion;
}

/** Drop every cached snapshot and stamp a new version, so any height cached
 *  against the old CSS is recognisably stale. */
export function invalidateMarkdownMetrics(): void {
  metricsVersion += 1;
  cache.clear();
  for (const listener of listeners) listener();
}

export function subscribeMarkdownMetrics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Recompute triggers. Each of these changes the answer getComputedStyle would
 * give, and none of them fires a resize on the container:
 *   - a webfont finishing load changes every advance width,
 *   - a theme class swap changes the custom properties the rules read.
 * Container resize is handled per view, because it changes the WIDTH key
 * rather than invalidating the metrics themselves.
 */
function installWatchers(doc: Document): void {
  if (watchersInstalled) return;
  watchersInstalled = true;
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts?.ready) void fonts.ready.then(() => invalidateMarkdownMetrics()).catch(() => {});
  const observer = new MutationObserver(() => invalidateMarkdownMetrics());
  observer.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  });
}

/** Probe (or reuse) the metrics for one row class at one content width. */
export function markdownMetricsFor(
  container: HTMLElement,
  rowClass: string,
  rootSelector: string,
  contentWidth: number,
): MarkdownMetrics | null {
  if (!(contentWidth > 0)) return null;
  const key = cacheKey(rowClass, contentWidth, harvestSignature(container, rootSelector));
  const hit = cache.get(key);
  if (hit && hit.metricsVersion === metricsVersion) return hit;
  installWatchers(container.ownerDocument);
  const probed = probeMetrics(
    container,
    rowClass,
    rootSelector,
    contentWidth,
    metricsVersion,
  );
  if (probed) cache.set(key, probed);
  return probed;
}

/**
 * Usable inner width of one rendered markdown root.
 *
 * From the bounding rect, not `clientWidth`: `clientWidth` is rounded to a
 * whole pixel, and the real cap here is fractional (640.31px on a 720px
 * column). Rounding it down loses a third of a pixel, which is invisible
 * until a line of text lands within that third of the cap — then it costs a
 * whole extra line, 26px, on that row.
 */
export function contentWidthOf(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const outer = el.getBoundingClientRect().width;
  return Math.max(
    0,
    outer -
      px(style.paddingLeft) -
      px(style.paddingRight) -
      px(style.borderLeftWidth) -
      px(style.borderRightWidth),
  );
}

/**
 * The width a markdown root is allowed to reach, read off real rendered rows.
 *
 * Not recomputed from the Tailwind classes: the width comes out of a chain of
 * percentage caps, a shrink-to-fit flex column and container padding, and a
 * reimplementation of that chain would drift the first time any link in it
 * changed.
 *
 * It is the MAXIMUM over the rendered roots, not any single one. Every bubble
 * is shrink-to-fit inside `items-start`, so a short turn is only as wide as
 * its own longest line; only a turn that overflows actually reaches the cap.
 * The cap is what line breaking needs, and a row narrower than it wraps the
 * same either way.
 */
export function contentWidthAcross(elements: ArrayLike<HTMLElement>): number {
  let widest = 0;
  for (let i = 0; i < elements.length; i += 1) {
    const width = contentWidthOf(elements[i]);
    if (width > widest) widest = width;
  }
  return widest;
}

// ---------------------------------------------------------------------------
// Text measurement
// ---------------------------------------------------------------------------

/**
 * pretext, wrapped in the shape the pure height model asks for.
 *
 * `prepare()` caches per (segment, font) internally, so the hot path over a
 * 4700-message transcript re-measures very little. The rich path is only taken
 * for blocks that actually carry inline markup — see RICH_INLINE_RE.
 */
export const pretextMeasurer: TextMeasurer = {
  plain(text, font, width, lineHeight, letterSpacing) {
    if (!text) return lineHeight;
    try {
      const prepared = prepare(text, font, letterSpacing ? { letterSpacing } : undefined);
      return layout(prepared, width, lineHeight).height;
    } catch {
      return lineHeight;
    }
  },
  rich(runs: InlineRun[], width, lineHeight) {
    if (!runs.length) return lineHeight;
    try {
      const prepared = prepareRichInline(
        runs.map((run) => ({
          text: run.text,
          font: run.font,
          letterSpacing: run.letterSpacing,
          extraWidth: run.extraWidth,
        })),
      );
      return measureRichInlineStats(prepared, width).lineCount * lineHeight;
    } catch {
      return lineHeight;
    }
  },
};

// ---------------------------------------------------------------------------
// Block splitting
// ---------------------------------------------------------------------------

let blockSplitter: ((markdown: string) => string[]) | null = null;
let blockSplitterPromise: Promise<void> | null = null;

/**
 * streamdown's own `parseMarkdownIntoBlocks`, which is the SAME splitter
 * Streamdown renders with. Nothing here re-implements it: a second block
 * splitter would be a second answer to "where does this block end", and the
 * two would disagree the first time either one changed.
 *
 * It arrives asynchronously because `streamdown` is a lazily loaded chunk
 * (see MessageResponse) and importing it eagerly here would pull the whole
 * renderer into the main bundle. Until it lands this returns null, and the
 * caller falls back to a flat row estimate — the same state it is in before
 * the first row has been probed. Resolving it invalidates the metrics, which
 * makes every consumer recompute.
 */
export function markdownBlockSplitter(): ((markdown: string) => string[]) | null {
  if (blockSplitter) return blockSplitter;
  if (!blockSplitterPromise) {
    blockSplitterPromise = import("streamdown")
      .then((mod) => {
        blockSplitter = mod.parseMarkdownIntoBlocks;
        invalidateMarkdownMetrics();
      })
      .catch(() => {
        blockSplitterPromise = null;
      });
  }
  return null;
}

// ---------------------------------------------------------------------------
// React binding
// ---------------------------------------------------------------------------

export type ChatMetrics = {
  assistant: MarkdownMetrics | null;
  user: MarkdownMetrics | null;
  mediaWidth: number;
  version: number;
};

const EMPTY_METRICS: ChatMetrics = { assistant: null, user: null, mediaWidth: 0, version: 0 };

/**
 * Sample the two markdown row shapes out of a live transcript and keep them
 * current. Nothing here writes to the DOM except the probe, which is removed
 * synchronously in the same call.
 *
 * `revision` is any value that changes when rows may have appeared — on a
 * freshly-mounted, still-empty transcript there is no rendered row to read a
 * width from, so the sample has to be retried once one exists. Retrying is
 * cheap: it is a querySelector plus a cache hit.
 */
export function useChatMarkdownMetrics(
  scrollRef: RefObject<HTMLElement | null>,
  revision: unknown,
): ChatMetrics {
  const [metrics, setMetrics] = useState<ChatMetrics>(EMPTY_METRICS);
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const sample = () => {
      const version = markdownMetricsVersion();
      const assistantWidth = contentWidthAcross(
        container.querySelectorAll<HTMLElement>(ASSISTANT_ROOT_SELECTOR),
      );
      const userWidth = contentWidthAcross(
        container.querySelectorAll<HTMLElement>(USER_ROOT_SELECTOR),
      );
      const previous = metricsRef.current;
      const assistant = assistantWidth
        ? markdownMetricsFor(container, ASSISTANT_ROW_CLASS, ASSISTANT_ROOT_SELECTOR, assistantWidth)
        : null;
      const user = userWidth
        ? markdownMetricsFor(container, USER_ROW_CLASS, USER_ROOT_SELECTOR, userWidth)
        : null;
      // A row class with no sample on screen keeps its last good snapshot: a
      // transcript that currently shows no user turn should not lose the user
      // metrics it already probed.
      const next: ChatMetrics = {
        assistant: assistant ?? previous.assistant,
        user: user ?? previous.user,
        mediaWidth: Math.max(0, container.clientWidth - 24),
        version,
      };
      if (
        next.assistant === previous.assistant &&
        next.user === previous.user &&
        next.mediaWidth === previous.mediaWidth &&
        next.version === previous.version
      ) {
        return;
      }
      setMetrics(next);
    };

    sample();
    const unsubscribe = subscribeMarkdownMetrics(sample);
    const observer = new ResizeObserver(() => sample());
    observer.observe(container);
    return () => {
      unsubscribe();
      observer.disconnect();
    };
  }, [scrollRef, revision]);

  return metrics;
}
