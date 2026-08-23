// Painting the matched text inside the row the find bar landed on.
//
// This uses the CSS Custom Highlight API rather than wrapping matches in
// `<mark>`, and that choice is load-bearing rather than stylistic:
//
//   - the transcript is virtualized, and every mounted row is measured through
//     `virtualizer.measureElement`. Injecting elements into a row changes its
//     measured height, which feeds straight back into the offsets the
//     virtualizer hands out. A highlight must not be able to move the
//     document under the reader it is trying to help;
//   - the rows are rendered by Streamdown from markdown. There is no safe seam
//     to inject spans into that output, and re-parsing it per keystroke would
//     be far more expensive than a range walk.
//
// A Highlight is an overlay: it paints, it never touches the tree. Where the
// API is missing the row still gets its outline from `.lfg-find-row`, so the
// reader is never left with no indication of where the hit was.

import { findMatchRanges } from "./transcript-find";

/** Must match the `::highlight()` rule in index.css. */
export const FIND_HIGHLIGHT_NAME = "lfg-find-hit";

type HighlightRegistry = Map<string, unknown> & {
  set(name: string, highlight: unknown): HighlightRegistry;
  delete(name: string): boolean;
};

type HighlightCtor = new (...ranges: Range[]) => unknown;

function registry(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights ?? null;
}

function highlightCtor(): HighlightCtor | null {
  return (globalThis as { Highlight?: HighlightCtor }).Highlight ?? null;
}

export function findHighlightSupported(): boolean {
  return !!registry() && !!highlightCtor();
}

/**
 * Every text node under `root`, with the offset at which each one starts in
 * the concatenated text. Concatenating first is what lets a term match across
 * an inline boundary — "deploy" split by a `<code>` tag is still one match to
 * the reader, and the server matched it against the flat message text anyway.
 *
 * Exported for tests: the mapping from a flat offset back to a (node, offset)
 * pair is the part that is easy to get wrong, and it needs no browser.
 */
export function collectTextSegments(root: Node): {
  text: string;
  segments: Array<{ node: Node; start: number; end: number }>;
} {
  const segments: Array<{ node: Node; start: number; end: number }> = [];
  let text = "";
  const doc = root.ownerDocument;
  if (!doc) return { text, segments };
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? "";
    if (!value) continue;
    segments.push({ node, start: text.length, end: text.length + value.length });
    text += value;
  }
  return { text, segments };
}

/**
 * Turn flat [start, end) ranges over the concatenated text into DOM Ranges.
 * A range that spans several text nodes becomes one Range with different
 * start and end containers, which is exactly what a Highlight wants.
 */
export function rangesForOffsets(
  segments: Array<{ node: Node; start: number; end: number }>,
  offsets: Array<[number, number]>,
  createRange: () => Range,
): Range[] {
  const ranges: Range[] = [];
  for (const [from, to] of offsets) {
    const startSeg = segments.find((seg) => from >= seg.start && from < seg.end);
    // `to` is exclusive, so the segment that owns it is the one containing to-1.
    const endSeg = segments.find((seg) => to - 1 >= seg.start && to - 1 < seg.end);
    if (!startSeg || !endSeg) continue;
    const range = createRange();
    range.setStart(startSeg.node, from - startSeg.start);
    range.setEnd(endSeg.node, to - endSeg.start);
    ranges.push(range);
  }
  return ranges;
}

/**
 * Paint `terms` inside `root`. Passing a null root or no terms clears it, so a
 * caller can treat this as "the highlight is whatever I last asked for".
 */
export function paintFindHighlight(root: HTMLElement | null, terms: string[]): void {
  const highlights = registry();
  const Ctor = highlightCtor();
  if (!highlights || !Ctor) return;
  if (!root || !terms.length) {
    highlights.delete(FIND_HIGHLIGHT_NAME);
    return;
  }
  const doc = root.ownerDocument;
  if (!doc) return;
  const { text, segments } = collectTextSegments(root);
  const ranges = rangesForOffsets(segments, findMatchRanges(text, terms), () =>
    doc.createRange(),
  );
  if (!ranges.length) {
    highlights.delete(FIND_HIGHLIGHT_NAME);
    return;
  }
  highlights.set(FIND_HIGHLIGHT_NAME, new Ctor(...ranges));
}

export function clearFindHighlight(): void {
  registry()?.delete(FIND_HIGHLIGHT_NAME);
}
