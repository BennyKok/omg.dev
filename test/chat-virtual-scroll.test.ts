import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * Source assertions on the virtualized transcript.
 *
 * These guard the property that cannot be unit tested from the outside: the
 * chat scroller has exactly ONE owner of scroll position. The virtualizer sits
 * inside the same component and is perfectly capable of writing scrollTop, so
 * the guard is on the wiring rather than on behaviour.
 */

const app = () => readFile("web/src/App.tsx", "utf8");

describe("the user can always get out of the scroll glide", () => {
  // Regression guard for 73a578b "Let the user out of the scroll glide".
  test("wheel, touchstart and pointerdown still cancel the glide", async () => {
    const source = await app();
    // The handler is beginUserScroll now: it cancels the glide AND marks the
    // scroll as the reader's, which is what lets the state machine act on it.
    // Assert the whole chain, so this stays a guard on the BEHAVIOUR and not
    // on one identifier.
    expect(source).toContain("onWheel={beginUserScroll}");
    expect(source).toContain("onTouchStart={beginUserScroll}");
    expect(source).toContain("onPointerDown={beginUserScroll}");
    const begin = source.indexOf("const beginUserScroll = useCallback(");
    expect(begin).toBeGreaterThan(-1);
    expect(source.slice(begin, begin + 220)).toContain("stopGlide();");
  });

  // Regression guard for d595fb3 "Stop the chat scroll glide from restarting
  // on every trigger". Three triggers land within a few frames; the glide is
  // started from one place and only when one is not already running.
  test("startGlide has a single call site, behind the follow decision", async () => {
    const source = await app();
    expect(source.match(/startGlide\(el\)/g)?.length).toBe(1);
    expect(source).toContain('if (glideAction === "start") {');
  });

  test("the glide uses the time-corrected spring", async () => {
    const source = await app();
    expect(source).toContain("nextTranscriptGlideFrame(glideSpringRef.current, delta, tickMs)");
    expect(source).toContain("completeTranscriptGlideFrame(");
    expect(source).not.toContain("el.scrollTop += delta * 0.3");
  });

  test("stream growth cannot cancel a glide that is already running", async () => {
    const source = await app();
    expect(source).toContain("const glideAction = transcriptGlideAction({");
    expect(source).toContain('if (glideAction === "start") {');
    expect(source).toContain('} else if (glideAction === "snap") {');
    expect(source).not.toContain("if (discrete && !reducedMotion) {");
  });
});

describe("the virtualizer supplies offsets only", () => {
  test("it scrolls through the existing ChatStream scroll ref and nothing else", async () => {
    const source = await app();
    expect(source).toContain("getScrollElement: () => ref.current,");
  });

  test("every internal scroll write is disabled", async () => {
    const source = await app();
    // scrollToFn is the funnel for every correction the library makes,
    // including one fired when the scroll element first attaches.
    expect(source).toContain("const noVirtualizerScroll = () => {};");
    expect(source).toContain("scrollToFn: noVirtualizerScroll,");
    // Undefined here does NOT mean "never adjust" — it selects the library
    // default, which writes scrollTop on an item's first measurement.
    expect(source).toContain(
      "virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;",
    );
  });

  test("nothing calls the imperative scroll methods", async () => {
    const source = await app();
    for (const method of ["scrollToIndex", "scrollToOffset", "scrollBy", "scrollToEnd"]) {
      expect(source).not.toContain(`virtualizer.${method}(`);
    }
  });
});

// Retained-tail behavior is exercised by chat-virtual-range.test.ts and the
// browser transcript harness. Source matching missed the overlapping-tail bug.

describe("one owner for the scroll correction", () => {
  // Anchor movement and deferred fling corrections are checked in the real
  // browser harness. The pure momentum decision has transcript-anchor.test.ts.
  test("the anchor is captured from real scroll events only", async () => {
    const source = await app();
    expect(source).toContain("if (!programmaticScrollRef.current) {");
    expect(source).toContain("captureAnchor(el);");
  });
});

describe("chrome stays outside the virtual window", () => {
  test("the older-messages spinner and the typing indicator are not virtual rows", async () => {
    const source = await app();
    const start = source.indexOf("<div\n            ref={virtualContainerRef}");
    const end = source.indexOf("<TypingIndicator visible={showTypingIndicator}");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const window = source.slice(start, end);
    expect(window).not.toContain("Loading older messages");
    expect(window).not.toContain("TypingIndicator");
  });
});

describe("what the transcript must not lose", () => {
  // da59171 "Memoize MessageBubble and ToolGroup".
  test("the row components are still memoized", async () => {
    const source = await app();
    expect(source).toContain("const MessageBubble = memo(function MessageBubble(");
    expect(source).toContain("const ToolGroup = memo(function ToolGroup(");
  });

  test("the entrance animations and the jump-to-latest pill survive", async () => {
    const source = await app();
    expect(source).toContain("lfg-msg-in");
    expect(source).toContain("lfg-user-send");
    expect(source).toContain("lfg-scroll-pill");
    // The pill sits outside the scroller, so virtualization cannot hide it.
    const pill = source.indexOf("lfg-scroll-pill pointer-events-auto");
    const scrollerEnd = source.indexOf("</Conversation>");
    expect(scrollerEnd).toBeGreaterThan(0);
    expect(pill).toBeGreaterThan(scrollerEnd);
  });

  test("the row gap moved into the row so a measured row matches the model", async () => {
    const source = await app();
    expect(source).toContain('className={cn("pb-2", speakerChanged && "pt-2.5")}');
  });
});
