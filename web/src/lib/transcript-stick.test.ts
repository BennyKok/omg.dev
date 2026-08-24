import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { nextScrollMode, pinnedByRequest, STICK_BOTTOM_SLACK_PX } from "./transcript-stick";

const APP = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

// A 400px pane over 4000px of content, reader parked 2000px down.
const base = { scrollTop: 2000, scrollHeight: 4000, clientHeight: 400, previousScrollTop: 2000 };
const at = (over: Partial<typeof base> & { userDriven: boolean }) => ({ ...base, ...over });

describe("transitions", () => {
  test("a gesture away from the bottom frees a pinned view", () => {
    expect(nextScrollMode("pinned", at({ userDriven: true }))).toBe("free");
  });

  test("the reader's own scroll reaching the bottom re-pins", () => {
    expect(
      nextScrollMode("free", at({ scrollTop: 3600, previousScrollTop: 3000, userDriven: true })),
    ).toBe("pinned");
  });

  test("jump-to-latest pins unconditionally", () => {
    expect(pinnedByRequest()).toBe("pinned");
  });

  test("a transcript shorter than its viewport is always pinned", () => {
    expect(nextScrollMode("free", at({ scrollHeight: 300, userDriven: false }))).toBe("pinned");
  });
});

/**
 * These are the point of the rewrite. Every bug in this area was a state
 * change nobody asked for, so each non-transition gets its own test.
 */
describe("non-transitions: only a person may change the mode", () => {
  // af3a8a1's bug. A shrink that passes the reader makes the browser clamp
  // scrollTop and raise one event at distance 0. A distance rule read that as
  // arriving at the bottom.
  test("a clamp does not re-pin", () => {
    expect(
      nextScrollMode("free", {
        scrollTop: 1800,
        scrollHeight: 2200,
        clientHeight: 400,
        previousScrollTop: 2000,
        userDriven: false,
      }),
    ).toBe("free");
  });

  // Belt and braces: even mid-gesture, a clamp moves the offset DOWN.
  test("a clamp does not re-pin even while a gesture is in flight", () => {
    expect(
      nextScrollMode("free", {
        scrollTop: 1800,
        scrollHeight: 2200,
        clientHeight: 400,
        previousScrollTop: 2000,
        userDriven: true,
      }),
    ).toBe("free");
  });

  test("a re-measure that shrinks the total does not re-pin", () => {
    expect(nextScrollMode("free", at({ scrollHeight: 2500, userDriven: false }))).toBe("free");
  });

  test("a re-measure does not unpin a pinned view either", () => {
    expect(
      nextScrollMode("pinned", at({ scrollTop: 100, scrollHeight: 9000, userDriven: false })),
    ).toBe("pinned");
  });

  test("our own glide frame does not unpin", () => {
    expect(
      nextScrollMode("pinned", at({ scrollTop: 1000, previousScrollTop: 500, userDriven: false })),
    ).toBe("pinned");
  });

  test("a prepend correction does not change the mode", () => {
    expect(
      nextScrollMode("free", at({ scrollTop: 4200, scrollHeight: 8000, previousScrollTop: 2000, userDriven: false })),
    ).toBe("free");
  });

  test("content growing under a freed reader does not re-pin", () => {
    expect(nextScrollMode("free", at({ scrollHeight: 12000, userDriven: false }))).toBe("free");
  });
});

describe("the threshold is consulted, never trusted alone", () => {
  test("sitting inside the slack without a gesture does not pin", () => {
    expect(
      nextScrollMode("free", at({ scrollTop: 3599, scrollHeight: 4000, userDriven: false })),
    ).toBe("free");
  });

  test("the slack is the documented distance", () => {
    expect(STICK_BOTTOM_SLACK_PX).toBe(72);
  });
});

describe("ChatStream wiring", () => {
  test("all four gesture kinds mark the reader as driving", () => {
    expect(APP).toContain("onWheel={beginUserScroll}");
    expect(APP).toContain("onTouchStart={beginUserScroll}");
    expect(APP).toContain("onPointerDown={beginUserScroll}");
    expect(APP).toContain("SCROLL_KEYS.has(event.key)");
  });

  test("a gesture still cancels the glide (73a578b)", () => {
    const i = APP.indexOf("const beginUserScroll = useCallback(");
    expect(i).toBeGreaterThan(-1);
    expect(APP.slice(i, i + 220)).toContain("stopGlide();");
  });

  test("every programmatic write disclaims authorship", () => {
    // One clear per write site, so no write can be read back as a gesture.
    const writes = APP.match(/lastScrollTopRef\.current = /g)?.length ?? 0;
    const clears = APP.match(/userDrivenRef\.current = false/g)?.length ?? 0;
    // Every write site except the onScroll baseline read clears the flag.
    expect(clears).toBe(writes - 1);
  });

  test("the old distance-only rule is gone", () => {
    expect(APP).not.toMatch(/setStick\([^)]*scrollHeight - [a-z]+\.scrollTop - [a-z]+\.clientHeight < 72/);
    expect(APP).toContain("nextScrollMode(");
  });

  test("content growth re-runs the guarded bottom pin", () => {
    const start = APP.indexOf("const scrollToBottom = useCallback(");
    const end = APP.indexOf("// The virtual list sits below", start);
    const pin = APP.slice(start, end);
    expect(pin).toContain("const bottom = el.scrollHeight - el.clientHeight;");
    expect(pin).toContain("Math.abs(el.scrollTop - bottom) <= 0.5");
    expect(pin).toContain("showTypingIndicator, totalSize, revealedSid, sid, startGlide");
  });
});
