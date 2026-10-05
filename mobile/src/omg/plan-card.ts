/**
 * What the Settings plan card says, derived once from the balance and the
 * live agent count.
 *
 * PORTED FROM THE DASHBOARD, wording included: vibes
 * apps/web/src/lib/plan-card.ts (#1887, #1894). Keep the strings in step with
 * it. Two parts are left out on purpose:
 *
 *   - The upsell line ("Go Pro: run 16 agents at once"). On the web it opens
 *     Stripe checkout. Here the only way to buy is the StoreKit screen behind
 *     the "Subscription and plan" row, and that row keeps its name for App
 *     Review (see the header of app/settings.tsx). A second call to action on
 *     the same card would only compete with it.
 *   - The plan art. The pictures live in the dashboard's public folder.
 *
 * Kept free of React and react-native so every state is pinned in
 * scripts/plan-card.native-check.ts.
 */

/** Credit below this share of the month's allowance reads as running low. */
export const LOW_CREDIT_FRACTION = 0.25;

/** The llm_usage window from `billing.getBalance`: the month's AI credit. */
export type BuildUsage = {
  limitUsd: number;
  remainingUsd: number;
  resetsAt: number;
};

/** `computer.getCloudComputerAgents`. `active` is null while the Computer sleeps. */
export type AgentCount = { active: number | null; limit: number };

export type PlanCardAgents = {
  /** "2 of 5 agents running", or "Up to 5 agents at once" while the count is unknown. */
  label: string;
  /** 0–100. 0 while the count is unknown. */
  usedPercent: number;
  /** Every slot is taken: the next launch is refused. */
  full: boolean;
};

export type PlanCardCredit = {
  /** "9% AI credit used" */
  used: string;
  /** "Resets Nov 1" */
  resets: string;
  /** 0–100, the share already spent. */
  usedPercent: number;
  low: boolean;
};

export type PlanCardModel = {
  agents: PlanCardAgents | null;
  credit: PlanCardCredit | null;
};

function agentsPhrase(count: number): string {
  return `${count} agent${count === 1 ? "" : "s"}`;
}

/** "now", "in 40m", "in 5h", or "Nov 1". Same rule as the dashboard. */
export function formatResetDate(ms: number, now: number = Date.now()): string {
  const diff = ms - now;
  if (diff <= 0) return "now";
  const hrs = diff / 3_600_000;
  if (hrs < 1) return `in ${Math.max(1, Math.round(diff / 60_000))}m`;
  if (hrs < 24) return `in ${Math.round(hrs)}h`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function planCardModel(input: {
  build: BuildUsage | null | undefined;
  agents: AgentCount | null | undefined;
  now?: number;
}): PlanCardModel {
  const now = input.now ?? Date.now();

  let agents: PlanCardAgents | null = null;
  if (input.agents && input.agents.limit > 0) {
    const { active, limit } = input.agents;
    agents =
      active == null
        ? { label: `Up to ${agentsPhrase(limit)} at once`, usedPercent: 0, full: false }
        : {
            label: `${active} of ${agentsPhrase(limit)} running`,
            usedPercent: Math.min(100, Math.round((active / limit) * 100)),
            full: active >= limit,
          };
  }

  let credit: PlanCardCredit | null = null;
  const build = input.build;
  // Free and the setup trial have no allowance (limitUsd 0): no row at all.
  if (build && build.limitUsd > 0) {
    const remaining = Math.max(0, Math.min(build.remainingUsd, build.limitUsd));
    const fraction = remaining / build.limitUsd;
    const usedPercent = 100 - Math.round(fraction * 100);
    credit = {
      used: `${usedPercent}% AI credit used`,
      resets: build.resetsAt - now <= 0 ? "Resets now" : `Resets ${formatResetDate(build.resetsAt, now)}`,
      usedPercent,
      low: fraction < LOW_CREDIT_FRACTION,
    };
  }

  return { agents, credit };
}

/** Read `build` out of a `billing.getBalance` reply. Anything malformed is null. */
export function parseBuildUsage(balance: unknown): BuildUsage | null {
  const build = (balance as { build?: unknown } | null)?.build as Record<string, unknown> | null | undefined;
  if (!build) return null;
  const { limitUsd, remainingUsd, resetsAt } = build;
  if (typeof limitUsd !== "number" || typeof remainingUsd !== "number" || typeof resetsAt !== "number") return null;
  if (![limitUsd, remainingUsd, resetsAt].every(Number.isFinite)) return null;
  return { limitUsd, remainingUsd, resetsAt };
}

/** Read a `computer.getCloudComputerAgents` reply. Null when there is no Computer. */
export function parseAgentCount(reply: unknown): AgentCount | null {
  const value = reply as { active?: unknown; limit?: unknown } | null;
  if (!value || typeof value.limit !== "number" || !Number.isFinite(value.limit)) return null;
  const active = typeof value.active === "number" && Number.isFinite(value.active) ? value.active : null;
  return { active, limit: value.limit };
}
