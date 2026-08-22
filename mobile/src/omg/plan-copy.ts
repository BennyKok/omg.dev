/**
 * Paywall merchandising copy. Not hardware facts.
 *
 * plan-specs.ts owns the rule that the phone never invents vCPU, hours, or
 * parallel-agent numbers for a paid rung: those arrive from the catalog, or
 * the row stays quiet. This file is the other half of the screen — the
 * headline, the taglines, and the Free row the mock locked.
 *
 * Free is not an App Store product. Its hours and parallel count are display
 * copy for a $0 try-out, not a StoreKit SKU and not a catalog spec. Paid
 * prices still come from Apple's displayPrice. Paid hours still come from
 * specs, or they do not appear.
 */

import { formatComputeHours, type TierSpecs } from "./plan-specs";

export const PAYWALL_HEADLINE = "A space for all your coding agents.";
export const PAYWALL_SUBHEAD = "Always at your fingertips.";

export const FREE_PLAN_KEY = "free";
export const PERSONAL_PLAN_KEY = "computer_5";
/** Old $5 / 20-hour Starter. Kept mappable; not a row on this screen. */
export const LEGACY_STARTER_PLAN_KEY = "computer_s20";
export const ALWAYS_ON_PLAN_KEY = "computer_20";

/** Locked Free row. Not in FALLBACK_TIERS and not sold through StoreKit. */
export const FREE_ROW = {
  plan: FREE_PLAN_KEY,
  label: "Free",
  tagline: "A computer to try",
  computeHours: 3,
  parallelAgents: 3,
  priceLabel: "$0",
} as const;

/**
 * One-line pitch per plan key. Words only.
 *
 * `computer_s40` is Starter on the locked web ladder. Its tagline stays
 * "A capable computer". `computer_s20` keeps the same words so a leftover
 * catalog entry is not blank if something still names it.
 */
const TAGLINES: Record<string, string> = {
  [FREE_PLAN_KEY]: FREE_ROW.tagline,
  computer_s20: "A capable computer",
  computer_s40: "A capable computer",
  computer_5: "A bigger, faster computer",
  computer_10: "The most powerful computer",
};

export function taglineForPlan(plan: string): string | undefined {
  return TAGLINES[plan];
}

export function isPopularPlan(plan: string): boolean {
  return plan === PERSONAL_PLAN_KEY;
}

/**
 * Always On and the old $5 Starter stay off this screen.
 *
 * Both product ids remain in FALLBACK_TIERS (or stay mappable) so a purchase
 * can still be named. They are not compact rows. A catalog that still
 * publishes either rung cannot put it back on this list.
 */
export function sellOnPaywall(
  plan: string,
  specs?: Pick<TierSpecs, "alwaysOn"> | null,
): boolean {
  if (plan === ALWAYS_ON_PLAN_KEY || plan === LEGACY_STARTER_PLAN_KEY) return false;
  if (specs?.alwaysOn) return false;
  return true;
}

/**
 * The locked web ladder: Starter $19 / Personal $38 / Pro $98.
 *
 * That is `computer_s40` / `computer_5` / `computer_10`. The old Starter
 * (`computer_s20`) stays in FALLBACK_TIERS so the product id stays mappable.
 * It is not a row on this list.
 */
export const COMPACT_PAID_PLANS = ["computer_s40", "computer_5", "computer_10"] as const;

export function isCompactPaidPlan(plan: string): boolean {
  return (COMPACT_PAID_PLANS as readonly string[]).includes(plan);
}

/** Personal, unless that SKU is not on sale in this storefront. */
export function defaultSelectedPlan(plans: readonly string[]): string {
  if (plans.includes(PERSONAL_PLAN_KEY)) return PERSONAL_PLAN_KEY;
  const paid = plans.find((plan) => plan !== FREE_PLAN_KEY);
  return paid ?? FREE_PLAN_KEY;
}

/**
 * "Continue · $38/mo" — Apple's string, then the period.
 *
 * `displayPrice` is already localised. This does not parse it, strip cents,
 * or invent a currency. Null means Free (or no price yet): just Continue.
 */
export function continueCtaLabel(displayPrice: string | null): string {
  return displayPrice ? `Continue · ${displayPrice}/mo` : "Continue";
}

/**
 * The compact allowance line: "150 hours · 5 in parallel".
 *
 * Hours use the dashboard formatter. The parallel figure is a bare number
 * plus "in parallel" so the mock can paint 5 and 16 in brand orange.
 */
export function formatAllowanceLine(computeHours: number, parallelAgents: number): {
  hours: string;
  parallelCount: string;
  parallelSuffix: string;
} {
  return {
    hours: formatComputeHours(computeHours),
    parallelCount: String(parallelAgents),
    parallelSuffix: "in parallel",
  };
}

/** The mock emphasises Personal's 5 and Pro's 16, not the shared 3. */
export function emphasizeParallel(parallelAgents: number): boolean {
  return parallelAgents >= 5;
}
