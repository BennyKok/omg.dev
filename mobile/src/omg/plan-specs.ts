/**
 * What a tier GIVES you — and the rule about where those facts may come from.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * THE PHONE COPIES THE WORDS. IT NEVER COPIES THE NUMBERS.
 *
 * "Compute time", "Machine", "Disk", "agents in parallel", "150 hours",
 * "8 GB" — the vocabulary and the formatting are deliberately identical to the
 * dashboard's (apps/web/src/lib/computer-plan-ladder.ts in BennyKok/vibes), and
 * they live in this file as a copy. A stale FORMATTER is a cosmetic bug: the
 * worst it can do is print "20 hrs" where the web prints "20 hours".
 *
 * The numbers are a different kind of thing. vCPU, memory, disk, parallel
 * agents and included hours are owned by three modules in another repo —
 * control-plane/lib/computer-policy.ts, control-plane/lib/agent-concurrency.ts
 * and the billing catalog — and a stale copy of those on THIS screen sells
 * someone a machine they do not get. So they are not in this bundle at all.
 * They arrive from the server, which can import all three directly, and this
 * module's only job is to check that what arrived is complete and then say it.
 *
 * ── Why not the usual drift guard ───────────────────────────────────────────
 *
 * This repo's normal answer to a necessary copy is a literal copy plus a
 * checker — scripts/check-theme-drift.ts reads web/src/index.css, compares, and
 * fails the build. Those work because both copies are in ONE repo, so CI can
 * read both. The billing catalog is in a different repo and a different
 * deployment, so there is no second file for a checker to open: a copy here
 * would rot silently and nothing would ever go red. On a paywall, rotting means
 * showing someone specs they are not buying.
 *
 * ── Missing is a state, not an error ────────────────────────────────────────
 *
 * A control plane that predates the catalog field sends no specs. That is
 * expected, not a failure, and the answer is to say LESS: the tier still
 * renders with its name and Apple's price, and simply makes no claims about
 * hardware. `parseTierSpecs` is all-or-nothing per tier for the same reason —
 * a spec card with one row quietly missing invites the reader to assume the row
 * they cannot see, which is worse than a card that never promised.
 */

/** The hardware and allowance facts behind one tier. Server-owned, all six or none. */
export type TierSpecs = {
  /** Coding agents this plan runs at the same time. The headline number. */
  parallelAgents: number;
  vcpus: number;
  memoryMb: number;
  diskGb: number;
  /**
   * Included active hours per month.
   *
   * Hours, not "credits": the plan's wallet is dollars of wall-time and the
   * rate card is dollars per hour, so the server divides one by the other and
   * sends the product's own unit rather than a marketing approximation.
   */
  computeHours: number;
  /** True when the Computer never pauses. One rung has this; it is the reason to buy that rung. */
  alwaysOn: boolean;
};

/** One sellable tier, as the server describes it. */
export type CatalogTier = {
  /** App Store Connect product id. The server owns this list too — see store.ts. */
  productId: string;
  /** omg plan key this product maps to. */
  plan: string;
  label: string;
  /** Null when the server did not describe this tier. Render nothing, never a guess. */
  specs: TierSpecs | null;
};

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The six facts, or null.
 *
 * Every field is required. A partial payload is treated as no payload rather
 * than as a card with gaps — see the header. `alwaysOn` is the one field
 * allowed to be false, so it is checked for type rather than for truth.
 */
export function parseTierSpecs(value: unknown): TierSpecs | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const parallelAgents = finitePositive(raw.parallelAgents);
  const vcpus = finitePositive(raw.vcpus);
  const memoryMb = finitePositive(raw.memoryMb);
  const diskGb = finitePositive(raw.diskGb);
  const computeHours = finitePositive(raw.computeHours);
  if (
    parallelAgents == null ||
    vcpus == null ||
    memoryMb == null ||
    diskGb == null ||
    computeHours == null ||
    typeof raw.alwaysOn !== "boolean"
  ) {
    return null;
  }

  return { parallelAgents, vcpus, memoryMb, diskGb, computeHours, alwaysOn: raw.alwaysOn };
}

/**
 * The tier list the server sent, or null when it sent none.
 *
 * Null and empty mean different things and the caller acts on the difference:
 * null is "this control plane does not publish a catalog", which falls back to
 * the product ids in the bundle; empty is "the catalog says nothing is on
 * sale", which is a real answer and must be shown as one. A tier missing an id,
 * a plan key or a label is dropped — it cannot be bought or named.
 */
export function parseCatalogTiers(value: unknown): CatalogTier[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    const productId = typeof raw.productId === "string" ? raw.productId : "";
    const plan = typeof raw.plan === "string" ? raw.plan : "";
    const label = typeof raw.label === "string" ? raw.label : "";
    if (!productId || !plan || !label) return [];
    return [{ productId, plan, label, specs: parseTierSpecs(raw.specs) }];
  });
}

/**
 * The tiers to fall back on when the server publishes no catalog — ids only.
 *
 * StoreKit cannot charge a variable amount, so metered overage and credit
 * top-ups have no representation here and must not be implied by this UI. They
 * stay web-only. Someone who needs them is not blocked; they simply are not
 * something Apple can sell.
 *
 * ── This list used to carry facts, and that is what changed ────────────────
 *
 * Each entry had a `detail` line — "4 vCPU, 150 active hours, 64 GB storage,
 * 5 agents at once." — mirrored by hand from the billing catalog in the vibes
 * repo. Those numbers were correct the day they were typed and unguardable
 * forever after: this repo's answer to a necessary copy is a checker that reads
 * both files (scripts/check-theme-drift.ts), and that only works INSIDE one
 * repo. Across two there is no second file for CI to open, so the copy could
 * only rot silently — on a paywall, where rotting means selling someone a
 * machine they do not get.
 *
 * `specs: null` on every entry is therefore not an oversight. It is this module
 * declining to have an opinion about hardware, and a test pins it that way.
 *
 * What remains is the minimum needed to sell anything at all against a control
 * plane that publishes no catalog. Product ids are pinned by the backend
 * (`OMG_APP_STORE_CONFIG.products`) and the two lists have to agree exactly: an
 * id present here but unmapped there is a purchase the server rejects with
 * "unmapped App Store productId" AFTER Apple has taken the money. When the
 * server does send a catalog its ids win, and that mismatch stops being
 * possible rather than merely being commented about.
 *
 * ── Always On is not here, and that is the second kind of disagreement ─────
 *
 * `computer_20` IS mapped in `OMG_APP_STORE_CONFIG.products`, so leaving it
 * here would not have risked the money-taken-and-rejected failure above. It is
 * absent because Benny's call is that iOS sells Starter through Pro only, and
 * that decision should be true in this list rather than enforced by the
 * accident that the product does not exist in App Store Connect — StoreKit
 * silently drops ids it cannot find, so this list would have looked wrong and
 * behaved right, until the day someone created the product for a sandbox test.
 *
 * Cost, stated rather than discovered: `labelForPlan` reads names out of this
 * same list, so an Always On subscriber on the web now reads "This account is
 * billed on the web" instead of "Your Always On plan is billed on the web".
 * Every call site already treats the label as optional for exactly this reason.
 */
export const FALLBACK_TIERS: readonly CatalogTier[] = [
  {
    productId: "dev.omg.computer.computer_s20.monthly.v1",
    plan: "computer_s20",
    label: "Starter",
    specs: null,
  },
  {
    productId: "dev.omg.computer.computer_s40.monthly.v1",
    plan: "computer_s40",
    label: "Starter Plus",
    specs: null,
  },
  {
    productId: "dev.omg.computer.computer_5.monthly.v1",
    plan: "computer_5",
    label: "Personal",
    specs: null,
  },
  {
    productId: "dev.omg.computer.computer_10.monthly.v1",
    plan: "computer_10",
    label: "Pro",
    specs: null,
  },
] as const;

/**
 * Name a plan key.
 *
 * Returns undefined rather than guessing: the server can report a plan this
 * build has never heard of — a grandfathered rung, or one added after the
 * binary shipped — and the caller decides whether to print the raw key or say
 * nothing. A made-up label on a billing surface is the same class of mistake as
 * a made-up spec.
 */
export function labelForPlan(
  plan: string | null | undefined,
  tiers: readonly CatalogTier[],
): string | undefined {
  if (!plan) return undefined;
  return tiers.find((tier) => tier.plan === plan)?.label;
}

export function tierForProduct(
  productId: string,
  tiers: readonly CatalogTier[],
): CatalogTier | undefined {
  return tiers.find((tier) => tier.productId === productId);
}

/* ── The words. Copied from the dashboard on purpose; see the header. ─────── */

/**
 * "150 hours" / "40 min". Hours are whole at every real rung, but a wallet that
 * genuinely buys some time must never round down to a bare "0 hours".
 */
export function formatComputeHours(hours: number): string {
  if (hours <= 0) return "None included";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
  return `${rounded} hours`;
}

export function formatMemory(memoryMb: number): string {
  return memoryMb >= 1024 ? `${memoryMb / 1024} GB` : `${memoryMb} MB`;
}

/** "4 vCPU · 8 GB" — the machine, as one unwrappable value. */
export function formatMachine(specs: TierSpecs): string {
  return `${specs.vcpus} vCPU · ${formatMemory(specs.memoryMb)}`;
}

/** "5 agents in parallel" / "1 agent in parallel". */
export function formatParallelAgents(count: number): string {
  return `${count} ${count === 1 ? "agent" : "agents"} in parallel`;
}

/**
 * The dashboard's "Sleeps between tasks" row, but only for the rung that
 * ANSWERS it differently.
 *
 * The web shows a single rung at a time, so it can afford this row on every one
 * of them ("Yes" / "Never — always on"). This screen lists all five at once,
 * where four identical "Yes" rows are noise — the shared behaviour is stated
 * once, under the list, and only the rung that breaks it says so on its card.
 * Null means "same as everything else here, don't repeat it".
 */
export function sleepsBetweenTasks(specs: TierSpecs): string | null {
  return specs.alwaysOn ? "Never" : null;
}
