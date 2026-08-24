import { describe, expect, test } from "bun:test";
import {
  FLING_EVENT_RECENCY_MS,
  anchorHoldDiag,
  shouldApplyAnchorCorrection,
} from "./transcript-anchor";

describe("shouldApplyAnchorCorrection", () => {
  test("a re-measure correction mid-fling is deferred — this is the momentum kill", () => {
    expect(
      shouldApplyAnchorCorrection({
        requested: false,
        userDriven: true,
        msSinceUserScroll: 16,
      }),
    ).toBe(false);
  });

  test("a stationary reader still gets the hold: no recent scroll event", () => {
    // userDriven stays true after a gesture until ChatStream writes scrollTop
    // itself, so recency is the discriminator, not the flag.
    expect(
      shouldApplyAnchorCorrection({
        requested: false,
        userDriven: true,
        msSinceUserScroll: FLING_EVENT_RECENCY_MS,
      }),
    ).toBe(true);
  });

  test("a correction after ChatStream's own write applies: not user driven", () => {
    expect(
      shouldApplyAnchorCorrection({
        requested: false,
        userDriven: false,
        msSinceUserScroll: 0,
      }),
    ).toBe(true);
  });

  test("a prepend correction applies even mid-fling: skipping it would teleport", () => {
    expect(
      shouldApplyAnchorCorrection({
        requested: true,
        userDriven: true,
        msSinceUserScroll: 0,
      }),
    ).toBe(true);
  });

  test("no scroll event ever seen applies: Infinity is not recent", () => {
    expect(
      shouldApplyAnchorCorrection({
        requested: false,
        userDriven: true,
        msSinceUserScroll: Number.POSITIVE_INFINITY,
      }),
    ).toBe(true);
  });

  test("the counters record every decision", () => {
    const applied = anchorHoldDiag.applied;
    const deferred = anchorHoldDiag.deferredMidFling;
    shouldApplyAnchorCorrection({ requested: false, userDriven: true, msSinceUserScroll: 1 });
    shouldApplyAnchorCorrection({ requested: false, userDriven: false, msSinceUserScroll: 1 });
    expect(anchorHoldDiag.deferredMidFling).toBe(deferred + 1);
    expect(anchorHoldDiag.applied).toBe(applied + 1);
  });
});
