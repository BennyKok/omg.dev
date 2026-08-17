import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Source-invariant guards, in the style of the ones in
// mobile-transcript-attachments.test.ts: this screen is a FlatList-heavy
// native component that isn't practically unit-testable end to end, so these
// pin the specific mechanisms that fixed the session-open flash/bump so a
// later edit can't quietly reintroduce them or half-wire a fix again.
const screen = readFileSync("mobile/app/session/[id].tsx", "utf8");

describe("opening a session does not flash or bump", () => {
  test("the initial page renders in one batch, not RN's default trickle", () => {
    expect(screen).toContain("initialNumToRender={PAGE}");
    expect(screen).toContain("maxToRenderPerBatch={PAGE}");
  });

  test("the transcript stays hidden until it has settled", () => {
    // The FlatList itself is opacity-gated (laid out, not painted) rather
    // than swapped for a different component, and there is exactly one
    // spinner covering both "still fetching" and "laid out but not pinned".
    expect(screen).toContain('style={{ opacity: contentReady ? 1 : 0 }}');
    expect(screen).toContain("!contentReady");
    expect(screen).toContain("setContentReady(true)");
    expect(screen).toContain("setContentReady(false)");
  });

  test("`fresh` is wired to a real signal, not dead code", () => {
    // Regression guard for the specific bug found while fixing this: `fresh`
    // was declared on TranscriptRow's props and never once passed `true`, so
    // the entrance animation it gates could never fire. It must now be tied
    // to an actual "this row is newly arrived" fact.
    expect(screen).toContain("liveKeysRef");
    expect(screen).toContain("fresh={contentReady && liveKeysRef.current.has(item.key)}");
    // Populated at both places a row is genuinely new — a live socket message
    // and this reader's own optimistic send — and NOT by the initial fetch or
    // a "load more" page, which must never animate in.
    expect(screen).toContain("liveKeysRef.current.add(incoming.id)");
    expect(screen).toContain("liveKeysRef.current.add(optimisticId)");
  });

  test("the initial chunk was reduced, and the reasoning is on the record", () => {
    expect(screen).toContain("const PAGE = 40;");
  });
});
