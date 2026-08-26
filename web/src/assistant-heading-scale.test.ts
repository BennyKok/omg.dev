// Regression coverage for assistant headings rendering SMALLER than the body
// text they introduce.
//
// `msg-text` sits on the assistant's markdown as well as the user's bubble, so
// a `.msg-text.markdown h2` rule written for the bubble (flat, 14px, no rule
// line) outranked `.markdown h2` and applied to every answer. All three heading
// levels came out at 14px against a 17px body: identical to each other, and
// smaller than the paragraphs under them.
//
// index.css is not cheap to render and the bug lives entirely in the cascade,
// so — following mobile-copy-button.test.ts — this asserts against the source.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Comments are stripped first: a selector is everything since the previous
// brace, so a doc comment above a rule would otherwise be read as part of it.
const CSS = readFileSync(join(import.meta.dir, "index.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Every rule in the sheet, as [selector list, declaration block]. */
const RULES: Array<[string[], string]> = [
  ...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map((m) => [m[1].split(",").map((s) => s.trim()).filter(Boolean), m[2]]);

/**
 * The font-size `selector` ends up with, as the cascade would resolve it among
 * rules of equal specificity: the last one that names it wins.
 *
 * Matching the selector anywhere in a rule's list — not just as the whole list
 * — is what makes this test fail loudly on the ORIGINAL bug rather than erroring
 * out. Back then the only rule naming `.msg-text.markdown h1` was the shared
 * three-selector one, and the failure should read "expected 14 to be greater
 * than 17", not "no rule found".
 */
function fontSize(selector: string): number {
  let size: number | null = null;
  for (const [sel, body] of RULES) {
    if (!sel.includes(selector)) continue;
    const px = /font-size:\s*([\d.]+)px/.exec(body);
    if (px) size = Number(px[1]);
  }
  if (size === null) throw new Error(`no font-size resolved for: ${selector}`);
  return size;
}

describe("assistant heading scale", () => {
  const body = fontSize(".msg-text.markdown");
  const h1 = fontSize(".msg-text.markdown h1");
  const h2 = fontSize(".msg-text.markdown h2");
  const h3 = fontSize(".msg-text.markdown h3");

  // Deliberately relations, not fixed numbers, so restyling the transcript
  // cannot silently reintroduce headings that read as fine print.
  //
  // The margin is 1px rather than a bare `>`. h3 first shipped at 17.5px
  // against a 17px body, which passes "larger than" and still renders as bold
  // body text -- the weight was doing all the work and the size none of it. A
  // relation this test can satisfy at half a pixel does not describe the
  // requirement.
  const MIN_STEP = 1;

  test("every heading level is meaningfully larger than the body text", () => {
    expect(h1).toBeGreaterThanOrEqual(body + MIN_STEP);
    expect(h2).toBeGreaterThanOrEqual(body + MIN_STEP);
    expect(h3).toBeGreaterThanOrEqual(body + MIN_STEP);
  });

  test("the three levels stay distinguishable from each other", () => {
    expect(h1).toBeGreaterThanOrEqual(h2 + MIN_STEP);
    expect(h2).toBeGreaterThanOrEqual(h3 + MIN_STEP);
  });

  test("flat 14px headings are scoped to the user's own bubble", () => {
    expect(fontSize(".msg-text.markdown.user-bubble h1")).toBe(14);
    expect(fontSize(".msg-text.markdown.user-bubble h3")).toBe(14);
  });
});
