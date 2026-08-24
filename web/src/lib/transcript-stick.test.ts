// The transcript must not re-pin itself to the bottom on its own.
//
// Reported symptom: "I still have the scroll snapping issue tho no new
// messages comes in and also i did override the scroll." The reader scrolled
// up on purpose, nothing arrived, and the transcript snapped down anyway.
//
// The numbers below are not invented. They were measured in Chromium over
// CDP on a 400px pane holding 4000px of content, with the reader parked at
// scrollTop 2000 — see the header of transcript-stick.ts.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nextStick, STICK_BOTTOM_SLACK_PX } from "./transcript-stick";

const CLIENT = 400;

describe("a re-measure never re-arms the pin", () => {
  test("a shrink that clamps the reader to the bottom does not re-arm it", () => {
    // Rows the reader scrolled past were only ever estimated. Measuring them
    // shortened the modelled total from 2450 to 2200, which is shorter than
    // the reader's own offset, so Chromium clamped scrollTop 2000 -> 1800 and
    // raised one scroll event. By distance alone that event is ind/
    // indistinguishable from a person arriving at the bottom: distance is 0.
    expect(
      nextStick(false, {
        scrollTop: 1800,
        scrollHeight: 2200,
        clientHeight: CLIENT,
        previousScrollTop: 2000,
      }),
    ).toBe(false);
  });

  test("a shrink that stops short of the reader does not re-arm it either", () => {
    // 2450px of content leaves the reader 50px from the bottom without moving
    // them. Chromium raises no scroll event at all here, so the rule is not
    // even consulted; it must still answer correctly if a later change starts
    // delivering one.
    expect(
      nextStick(false, {
        scrollTop: 2000,
        scrollHeight: 2450,
        clientHeight: CLIENT,
        previousScrollTop: 2000,
      }),
    ).toBe(false);
  });

  test("ChatStream's own anchor correction does not re-arm it", () => {
    // Rows above the reader measured taller, so ChatStream wrote scrollTop
    // forward to hold the reader's row still. It records the offset it wrote,
    // so the scroll event that write raises reports no movement.
    expect(
      nextStick(false, {
        scrollTop: 2600,
        scrollHeight: 2672,
        clientHeight: CLIENT,
        previousScrollTop: 2600,
      }),
    ).toBe(false);
  });

  test("a shrink cannot unpin a reader who is already at the bottom", () => {
    // The mirror case. Stick-to-bottom still has to work.
    expect(
      nextStick(true, {
        scrollTop: 1800,
        scrollHeight: 2200,
        clientHeight: CLIENT,
        previousScrollTop: 2000,
      }),
    ).toBe(true);
  });
});

describe("the reader still owns the pin", () => {
  test("travelling back down to the bottom re-arms it", () => {
    expect(
      nextStick(false, {
        scrollTop: 3550,
        scrollHeight: 4000,
        clientHeight: CLIENT,
        previousScrollTop: 3400,
      }),
    ).toBe(true);
  });

  test("the last step down still has to reach the slack", () => {
    expect(
      nextStick(false, {
        scrollTop: 3400,
        scrollHeight: 4000,
        clientHeight: CLIENT,
        previousScrollTop: 3200,
      }),
    ).toBe(false);
  });

  test("scrolling away from the bottom drops it", () => {
    expect(
      nextStick(true, {
        scrollTop: 3000,
        scrollHeight: 4000,
        clientHeight: CLIENT,
        previousScrollTop: 3600,
      }),
    ).toBe(false);
  });

  test("staying inside the slack keeps it", () => {
    expect(
      nextStick(true, {
        scrollTop: 4000 - CLIENT - (STICK_BOTTOM_SLACK_PX - 1),
        scrollHeight: 4000,
        clientHeight: CLIENT,
        previousScrollTop: 4000 - CLIENT,
      }),
    ).toBe(true);
  });

  test("a transcript that does not overflow keeps the pin", () => {
    // It sits at the top and at the bottom at once, so no gesture can ever
    // express a preference. The backfill path depends on this reading.
    expect(
      nextStick(false, {
        scrollTop: 0,
        scrollHeight: 300,
        clientHeight: CLIENT,
        previousScrollTop: 0,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The wiring. App.tsx mounts the app on import in a browser context, so this
// asserts against source text, the same way chat-find-invariants.test.ts does.

const WEB = join(import.meta.dir, "..", "..");
const APP = readFileSync(join(WEB, "src/App.tsx"), "utf8");

const CHAT_STREAM = (() => {
  const start = APP.indexOf("const ChatStream = memo(function ChatStream(");
  expect(start).toBeGreaterThan(-1);
  const end = APP.indexOf("const TOOL_GROUP_HOVER_OPEN_MS", start);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
})();

// The slices are megabyte-scale, so every assertion below reduces to a
// boolean or a count first. A raw `expect(CHAT_STREAM)` dumps the whole
// component into the failure report and buries the reason.
const has = (needle: string) => CHAT_STREAM.includes(needle);
const count = (pattern: RegExp) => [...CHAT_STREAM.matchAll(pattern)].length;

describe("ChatStream reads the pin through this rule and nothing else", () => {
  test("the scroll handler delegates to nextStick", () => {
    expect(count(/setStick\(\(prev\) =>\s*nextStick\(prev, \{/g)).toBe(1);
    expect(has("previousScrollTop,")).toBe(true);
  });

  test("no distance-only derivation survives anywhere in ChatStream", () => {
    // The regression itself: `stick` inferred from a measurement the reader
    // did not cause.
    expect(count(/setStick\([^)]*scrollHeight/g)).toBe(0);
  });

  test("every scrollTop ChatStream writes is recorded as the baseline", () => {
    // The rule reads a direction, so the offsets ChatStream writes itself must
    // not look like the reader moving. Each direct write records itself.
    // Six of them: the glide settle, the glide step, the pin snap, the find
    // jump, the find restore and the anchor correction.
    const writes = count(/^\s*(?:if \([^)]*\) )?el\.scrollTop [+]?= /gm);
    expect(writes).toBeGreaterThan(0);
    expect(count(/lastScrollTopRef\.current = el\.scrollTop;/g)).toBeGreaterThanOrEqual(writes);
  });

  test("the pin snap targets the bottom offset, not the content height", () => {
    // `el.scrollTop = el.scrollHeight` only ever worked because the browser
    // clamps it. It said the wrong thing about the intent.
    expect(has("el.scrollTop = el.scrollHeight;")).toBe(false);
    expect(has("el.scrollTop = el.scrollHeight - el.clientHeight;")).toBe(true);
  });
});
