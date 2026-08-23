// The transcript find bar must not become a second owner of scroll position.
//
// ChatStream owns scrollTop through startGlide, stopGlide, programmaticScrollRef,
// `stick` and preserveScrollRef. Virtualizing the transcript (38a0b1a) only
// stayed safe because two virtualizer settings were pinned shut, and the glide
// only stayed cancellable because three pointer events are wired to stopGlide
// (73a578b, d595fb3). Adding a feature that scrolls on purpose is exactly the
// kind of change that quietly unpicks all of that, so this asserts the wiring
// is still there afterwards.
//
// App.tsx mounts the app on import in a browser context, so — following
// message-copy-button-layout.test.ts and mobile-copy-button.test.ts — this
// asserts against source text rather than rendering.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..");
const APP = readFileSync(join(WEB, "src/App.tsx"), "utf8");
const CSS = readFileSync(join(WEB, "src/index.css"), "utf8");

/** Just the ChatStream component, so counts cannot be diluted by the rest of the file. */
const CHAT_STREAM = (() => {
  const start = APP.indexOf("const ChatStream = memo(function ChatStream(");
  expect(start).toBeGreaterThan(-1);
  const end = APP.indexOf("const TOOL_GROUP_HOVER_OPEN_MS", start);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
})();

describe("the virtualizer still supplies offsets only", () => {
  test("scrollToFn is a no-op, and it is the one wired into the virtualizer", () => {
    // In virtual-core 3.17 every internal correction funnels through
    // scrollToFn, including one fired the moment the scroll element attaches
    // with a null offset that resolves to zero. Restoring it would yank an
    // opened transcript to the top on mount.
    expect(APP).toContain("const noVirtualizerScroll = () => {};");
    expect(CHAT_STREAM).toContain("scrollToFn: noVirtualizerScroll,");
    // No second, working implementation smuggled in beside it.
    expect(CHAT_STREAM).not.toMatch(/scrollToFn:\s*\(/);
  });

  test("shouldAdjustScrollPositionOnItemSizeChange still returns false", () => {
    // Leaving it undefined does not mean "never adjust": undefined selects the
    // built-in default, which writes scrollTop on an item's first measurement.
    expect(CHAT_STREAM).toContain(
      "virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;",
    );
    expect(CHAT_STREAM).not.toMatch(
      /shouldAdjustScrollPositionOnItemSizeChange\s*=\s*\(\)\s*=>\s*true/,
    );
  });

  test("no virtualizer scroll API is called at all", () => {
    // scrollToIndex included: with scrollToFn a no-op it moves nothing and
    // then spins a five-second reconcile loop chasing a target it can never
    // reach. jumpToFindRow reads measurementsCache instead and writes
    // scrollTop through ChatStream, the existing owner.
    for (const api of ["scrollToIndex(", "scrollToOffset(", "scrollBy(", "scrollToEnd("]) {
      expect(CHAT_STREAM).not.toContain(`virtualizer.${api}`);
      expect(CHAT_STREAM).not.toContain(`.${api}`);
    }
  });

  test("the find jump reads an offset rather than asking the virtualizer to move", () => {
    const jump = CHAT_STREAM.slice(
      CHAT_STREAM.indexOf("const jumpToFindRow = useCallback("),
      CHAT_STREAM.indexOf("const goToFindHit = useCallback("),
    );
    expect(jump).toContain("virtualizer.measurementsCache[index]");
    expect(jump).toContain("el.scrollTop = clamped;");
    // Landing on a hit is a manual scroll as far as stick-to-bottom is
    // concerned, so the jump-to-latest pill behaves the same as after a drag.
    expect(jump).toContain("stopGlide();");
    expect(jump).toContain("setStick(false);");
  });
});

describe("the glide is still cancellable by a person (73a578b, d595fb3)", () => {
  test("stopGlide is bound to onWheel, onTouchStart and onPointerDown", () => {
    for (const handler of ["onWheel", "onTouchStart", "onPointerDown"]) {
      expect(CHAT_STREAM).toContain(`${handler}={stopGlide}`);
    }
  });

  test("startGlide still has exactly one call site", () => {
    // d595fb3: three triggers restarting the RAF loop within a few frames was
    // the stutter. The find bar must not add a fourth.
    const calls = [...CHAT_STREAM.matchAll(/\bstartGlide\(/g)];
    // One definition plus one call.
    expect(CHAT_STREAM).toContain("const startGlide = useCallback(");
    expect(calls).toHaveLength(1);
  });

  test("closing the find bar re-engages stick rather than writing a second scroll", () => {
    const close = CHAT_STREAM.slice(
      CHAT_STREAM.indexOf("const closeFind = useCallback("),
      CHAT_STREAM.indexOf("const onFindKeyDown = useCallback("),
    );
    expect(close).toContain("setStick(true);");
    expect(close).toContain("stopGlide();");
    // A reader who was NOT pinned goes back to their anchor, which survives
    // the pages the chase may have prepended above them.
    expect(close).toContain("virtualizer.measurementsCache[index]?.start");
  });
});

describe("Ctrl+F is not stolen, and Find is still reachable", () => {
  test("no global find binding", () => {
    // The transcript pane is not focusable, so a pane-scoped binding could
    // never fire and the only working binding is a global one. Taking the
    // browser's own find away from the whole app to repair one pane is a worse
    // trade than the bug.
    expect(APP).not.toMatch(/key\s*===\s*["']f["']/i);
    expect(APP).not.toMatch(/preventDefault\(\)[\s\S]{0,80}openFind/);
  });

  test("a visible Find affordance is always offered while there is a transcript", () => {
    expect(CHAT_STREAM).toContain('aria-label="Find in transcript"');
    expect(CHAT_STREAM).toContain("onClick={openFind}");
    // Gated on there being something to search, not on any other state.
    expect(CHAT_STREAM).toMatch(/\{visibleMessages\.length \? \(\s*<div[^>]*absolute inset-x-0 top-2/);
  });

  test("Escape closes the bar", () => {
    const keys = CHAT_STREAM.slice(
      CHAT_STREAM.indexOf("const onFindKeyDown = useCallback("),
      CHAT_STREAM.indexOf("// A find session belongs to one transcript"),
    );
    expect(keys).toMatch(/event\.key === "Escape"[\s\S]{0,120}closeFind\(\)/);
    expect(keys).toContain("stepFind(event.shiftKey ? 1 : -1)");
  });
});

describe("the landed-row marker cannot change a measured row's height", () => {
  test("it is a data attribute, not a class on the measured row", () => {
    // The row wrapper is handed to virtualizer.measureElement. Its spacing
    // classes are asserted elsewhere (message-copy-button-layout.test.ts) and
    // stay untouched here on purpose.
    expect(CHAT_STREAM).toContain('data-find-hit={findHitRow === index ? "true" : undefined}');
    expect(CHAT_STREAM).toContain('className={cn("pb-2", speakerChanged && "pt-2.5")}');
  });

  test("the marked row is resolved from the message id, not a remembered index", () => {
    // Chasing a later hit prepends pages above the landed one. Its index moves;
    // the row does not. Keying the outline on the old index would paint some
    // unrelated message instead.
    expect(CHAT_STREAM).toContain(
      "const findHitRow = findRow ? findRowIndex.get(findRow) ?? null : null;",
    );
    // No remembered index to go stale in the first place.
    expect(CHAT_STREAM).toContain("const [findRow, setFindRow] = useState<string | null>(null);");
  });

  test("the outline draws outside the box model", () => {
    const rule = /\.chat-stream \[data-find-hit="true"\]\s*\{[^}]*\}/.exec(CSS)?.[0] ?? "";
    expect(rule).toContain("outline:");
    // border, padding and margin would all move the row and therefore the
    // reader, away from the very match they jumped to.
    expect(rule).not.toMatch(/\bborder:/);
    expect(rule).not.toMatch(/\bpadding\b/);
    expect(rule).not.toMatch(/\bmargin\b/);
  });

  test("the text highlight paints without entering the tree", () => {
    expect(CSS).toContain("::highlight(lfg-find-hit)");
    // No <mark> injection into Streamdown output, which would re-measure.
    expect(CHAT_STREAM).not.toContain("<mark");
  });
});

describe("an unloaded hit is chased, not dropped", () => {
  const chase = CHAT_STREAM.slice(
    CHAT_STREAM.indexOf("// Chasing a hit that has not been paged in yet."),
    CHAT_STREAM.indexOf("// One search per settled query."),
  );

  test("it pages older messages through the existing loader", () => {
    expect(chase).toContain("onLoadOlderMessages(sid)");
    expect(chase).toContain("setHasOlder(more);");
  });

  test("the chase is bounded and says so instead of failing silently", () => {
    expect(chase).toContain("findJump.pages >= FIND_MAX_LOAD_PAGES");
    expect(chase).toContain("setFindNotice(");
    // Both dead ends are distinguished: out of budget, versus the message is
    // filtered out of this view and no amount of paging will produce it.
    expect(chase).toContain("Press again to keep going.");
    expect(chase).toContain("Switch to the full view to see it.");
  });

  test("only a user press can start a chase", () => {
    // The effect is a continuation of next/previous, not an autonomous
    // scroller: nothing but goToFindHit sets findJump to a target.
    const setters = [...CHAT_STREAM.matchAll(/setFindJump\(\{ messageId/g)];
    expect(setters).toHaveLength(1);
    const goTo = CHAT_STREAM.slice(
      CHAT_STREAM.indexOf("const goToFindHit = useCallback("),
      CHAT_STREAM.indexOf("   * Step through the hits."),
    );
    expect(goTo).toContain("setFindJump({ messageId: hit.messageId, pages: 0 });");
  });
});
