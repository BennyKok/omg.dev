// Regression coverage for the transcript's vertical rhythm.
//
// The per-message copy button used to be an in-flow block (`mt-1` + `size-7`),
// so every turn that carried text reserved an empty 28px row under its bubble.
// Measured on the live UI before the fix: two assistant bubbles in a row sat
// 36px apart and a speaker change sat 46px apart, with the copy icon painting
// into that band on hover — the "separate row under the bubble" in the report.
// Out of flow the same pairs measure 8px and 18px.
//
// App.tsx is a large, side-effect-bearing entry module (it mounts the app on
// import in a browser context), so — following the pattern already used by
// mobile-copy-button.test.ts and embedded-lib-smoke.release-check.ts — this asserts
// against source text. Where a raw string match would only echo the code, the
// assertions parse the real numbers out and compare them, so the invariant is
// checked rather than restated.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..");
const APP = readFileSync(join(WEB, "src/App.tsx"), "utf8");
const CSS = readFileSync(join(WEB, "src/index.css"), "utf8");
const CONVERSATION = readFileSync(
  join(WEB, "src/components/ai-elements/conversation.tsx"),
  "utf8",
);

const MESSAGE_ACTIONS = APP.slice(APP.indexOf("function MessageActions("));
// The wrap is the positioned parent; the button is the element inside it.
const WRAP_CLASSES = MESSAGE_ACTIONS.slice(
  MESSAGE_ACTIONS.indexOf('"message-actions-wrap'),
  MESSAGE_ACTIONS.indexOf("onPointerDown={onPointerDown}"),
);
const BUTTON_CLASSES = MESSAGE_ACTIONS.slice(
  MESSAGE_ACTIONS.indexOf('"message-copy-button'),
  MESSAGE_ACTIONS.indexOf("aria-label={copied"),
);

const REM_PX = 16;

/** Tailwind spacing scale: `size-7` / `ml-1` are 0.25rem units. */
function spacingRem(token: string): number {
  const match = new RegExp(`\\b${token}-(\\d+(?:\\.\\d+)?)\\b`).exec(BUTTON_CLASSES);
  if (!match) throw new Error(`no ${token}-* utility on the copy button`);
  return Number(match[1]) * 0.25;
}

describe("per-message copy button stays out of the transcript's vertical flow", () => {
  test("is absolutely positioned against its own message, not stacked under it", () => {
    expect(BUTTON_CLASSES).toContain("absolute");
    expect(BUTTON_CLASSES).toContain("bottom-0");
    // The wrap has to be the containing block, or the button escapes to the
    // nearest positioned ancestor and lands on some other message.
    expect(WRAP_CLASSES).toContain("relative");
  });

  test("carries no vertical margin, which is what used to open the empty row", () => {
    expect(BUTTON_CLASSES).not.toMatch(/\bmt-\d/);
    expect(BUTTON_CLASSES).not.toMatch(/\bmb-\d/);
    expect(BUTTON_CLASSES).not.toMatch(/\bmy-\d/);
  });

  test("sits in the outward gutter on the side its speaker is aligned to", () => {
    // Assistant bubbles hug the left edge, so their button goes right; user
    // bubbles hug the right edge, so their button goes left. Either way it is
    // beside its own bubble and reads as belonging to it.
    expect(BUTTON_CLASSES).toContain("left-full");
    expect(BUTTON_CLASSES).toContain("right-full");
    expect(BUTTON_CLASSES).toMatch(/isUser \?[\s\S]*right-full[\s\S]*left-full/);
  });
});

describe("the out-of-flow button cannot overflow the row horizontally", () => {
  // A button that no longer takes vertical space takes horizontal space
  // instead: it hangs outside the bubble's own box. Both width caps therefore
  // subtract a gutter, and that gutter has to be at least as wide as the
  // button plus its offset or a bubble at the cap pushes it past the scroll
  // container — trading the vertical gap for a horizontal scrollbar.
  const caps = [...WRAP_CLASSES.matchAll(/max-w-\[min\((\d+)%,calc\(100%-([\d.]+)rem\)\)\]/g)];

  test("both speakers' caps reserve a gutter", () => {
    expect(caps.length).toBe(2);
    expect(caps.map((c) => c[1]).sort()).toEqual(["85", "92"]);
  });

  test("the reserved gutter is wider than the button plus its offset", () => {
    const buttonRem = spacingRem("size");
    const offsetRem = Math.max(spacingRem("ml"), spacingRem("mr"));
    expect(buttonRem * REM_PX).toBe(28);
    for (const cap of caps) {
      expect(Number(cap[2])).toBeGreaterThanOrEqual(buttonRem + offsetRem);
    }
  });
});

describe("hidden copy button is not an invisible tap target", () => {
  // Out of flow, the transparent button sits in the margin beside every
  // bubble. Left clickable it would copy on a stray tap with nothing on
  // screen to explain it.
  test("pointer-events are off while it is transparent", () => {
    const base = /\.message-copy-button\s*\{[^}]*\}/.exec(CSS)?.[0] ?? "";
    expect(base).toContain("opacity: 0;");
    expect(base).toContain("pointer-events: none;");
  });

  test("both reveal paths restore them, so hover and keyboard focus can click", () => {
    for (const selector of [
      ".group\\/message:focus-within .message-copy-button {",
      ".group\\/message:hover .message-copy-button {",
    ]) {
      const start = CSS.indexOf(selector);
      expect(start).toBeGreaterThan(-1);
      const rule = CSS.slice(start, CSS.indexOf("}", start));
      expect(rule).toContain("opacity: 1;");
      expect(rule).toContain("pointer-events: auto;");
    }
  });
});

describe("consecutive messages keep one consistent vertical rhythm", () => {
  test("the row container's gap is the whole same-speaker distance", () => {
    // gap-1 was authored while every row carried the ~32px button block, so
    // it was never the real gap between two bubbles. With the button out of
    // flow this single utility is the entire same-speaker distance.
    expect(CONVERSATION).toMatch(/cn\("flex flex-col gap-2"/);
  });

  test("only a speaker change adds anything on top of that gap", () => {
    const loop = APP.slice(APP.indexOf("const speakerChanged ="));
    const spacing = loop.slice(0, loop.indexOf("{item.type ==="));
    expect(spacing).toContain('speakerChanged ? "pt-2.5" : undefined');
    // No second, per-message spacing source: same-speaker rows get the
    // container gap and nothing else.
    expect(spacing).not.toMatch(/speakerChanged \? "pt-2\.5" : "[^"]+"/);
  });
});
