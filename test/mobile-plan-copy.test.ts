/**
 * Paywall merchandising copy, as tests.
 *
 * The companion file (test/mobile-plan-specs.test.ts) pins the safety rule:
 * the phone never invents paid-tier hardware numbers. This file pins the
 * locked mock copy and the merchandising filter — headline, Free row, default
 * selection, CTA, and "Always On stays off the compact list".
 */

import { describe, expect, test } from "bun:test";

import {
  COMPACT_PAID_PLANS,
  continueCtaLabel,
  defaultSelectedPlan,
  emphasizeParallel,
  formatAllowanceLine,
  FREE_PLAN_KEY,
  FREE_ROW,
  isCompactPaidPlan,
  isPopularPlan,
  PAYWALL_HEADLINE,
  PAYWALL_SUBHEAD,
  PERSONAL_PLAN_KEY,
  sellOnPaywall,
  taglineForPlan,
} from "../mobile/src/omg/plan-copy";
import { FALLBACK_TIERS } from "../mobile/src/omg/plan-specs";

describe("the locked onboarding copy", () => {
  test("headline and sub match the mock", () => {
    expect(PAYWALL_HEADLINE).toBe("A space for all your coding agents.");
    expect(PAYWALL_SUBHEAD).toBe("Always at your fingertips.");
  });

  test("Free is display copy, not a StoreKit product", () => {
    expect(FREE_ROW.label).toBe("Free");
    expect(FREE_ROW.tagline).toBe("A computer to try");
    expect(FREE_ROW.computeHours).toBe(3);
    expect(FREE_ROW.parallelAgents).toBe(3);
    expect(FREE_ROW.priceLabel).toBe("$0");
    expect(FALLBACK_TIERS.some((tier) => tier.plan === FREE_PLAN_KEY)).toBe(false);
    expect(FALLBACK_TIERS.some((tier) => tier.productId.includes("free"))).toBe(false);
  });

  test("paid taglines match the mock", () => {
    expect(taglineForPlan("computer_s20")).toBe("A capable computer");
    expect(taglineForPlan("computer_5")).toBe("A bigger, faster computer");
    expect(taglineForPlan("computer_10")).toBe("The most powerful computer");
  });

  test("Personal is the popular default", () => {
    expect(isPopularPlan(PERSONAL_PLAN_KEY)).toBe(true);
    expect(isPopularPlan("computer_10")).toBe(false);
    expect(defaultSelectedPlan(["free", "computer_s20", "computer_5", "computer_10"])).toBe(
      PERSONAL_PLAN_KEY,
    );
  });

  test("a storefront without Personal still picks a paid rung", () => {
    expect(defaultSelectedPlan(["free", "computer_s20"])).toBe("computer_s20");
    expect(defaultSelectedPlan([FREE_PLAN_KEY])).toBe(FREE_PLAN_KEY);
  });
});

describe("the compact merchandising list", () => {
  test("the paid rows are Starter, Personal, Pro", () => {
    expect(COMPACT_PAID_PLANS).toEqual(["computer_s20", "computer_5", "computer_10"]);
    expect(isCompactPaidPlan("computer_s20")).toBe(true);
    expect(isCompactPaidPlan("computer_s40")).toBe(false);
    expect(isCompactPaidPlan("computer_20")).toBe(false);
  });

  test("Always On is not sold on this list", () => {
    expect(sellOnPaywall("computer_20")).toBe(false);
    expect(sellOnPaywall("computer_10", { alwaysOn: true })).toBe(false);
    expect(sellOnPaywall("computer_5")).toBe(true);
  });

  test("product ids in the fallback list do not change", () => {
    expect(FALLBACK_TIERS.map((tier) => tier.productId)).toEqual([
      "dev.omg.computer.computer_s20.monthly.v1",
      "dev.omg.computer.computer_s40.monthly.v1",
      "dev.omg.computer.computer_5.monthly.v1",
      "dev.omg.computer.computer_10.monthly.v1",
    ]);
  });
});

describe("the continue button", () => {
  test("paid uses Apple's price string, Free does not invent one", () => {
    expect(continueCtaLabel("$38.00")).toBe("Continue · $38.00/mo");
    expect(continueCtaLabel("HK$47.00")).toBe("Continue · HK$47.00/mo");
    expect(continueCtaLabel(null)).toBe("Continue");
  });

  test("allowance copy matches the compact line", () => {
    expect(formatAllowanceLine(150, 5)).toEqual({
      hours: "150 hours",
      parallelCount: "5",
      parallelSuffix: "in parallel",
    });
    expect(formatAllowanceLine(3, 3)).toEqual({
      hours: "3 hours",
      parallelCount: "3",
      parallelSuffix: "in parallel",
    });
  });

  test("only the bigger parallel counts are emphasised", () => {
    expect(emphasizeParallel(3)).toBe(false);
    expect(emphasizeParallel(5)).toBe(true);
    expect(emphasizeParallel(16)).toBe(true);
  });
});
