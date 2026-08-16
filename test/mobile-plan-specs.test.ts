/**
 * The paywall's one safety rule, as tests: THE PHONE NEVER INVENTS A SPEC.
 *
 * These facts (vCPU, memory, disk, parallel agents, included hours, always-on)
 * are owned by the control plane in the vibes repo, which can import all three
 * of their owning modules directly. This repo cannot, and cannot run a drift
 * checker across the boundary either — so the phone's protection is not "the
 * copy is correct", it is "there is no copy, and a malformed payload renders as
 * silence rather than as a number".
 *
 * Every test below is a way the server could hand over something wrong. The
 * required answer is always the same: null, and a card that makes no claim.
 */

import { describe, expect, test } from "bun:test";

import {
  formatComputeHours,
  formatMachine,
  formatMemory,
  formatParallelAgents,
  FALLBACK_TIERS,
  parseCatalogTiers,
  parseTierSpecs,
  sleepsBetweenTasks,
} from "../mobile/src/omg/plan-specs";

const PERSONAL = {
  productId: "dev.omg.computer.computer_5.monthly.v1",
  plan: "computer_5",
  label: "Personal",
  specs: {
    parallelAgents: 5,
    vcpus: 4,
    memoryMb: 8192,
    diskGb: 64,
    computeHours: 150,
    alwaysOn: false,
  },
};

describe("the tier facts the server sends", () => {
  test("a complete payload comes through unchanged", () => {
    expect(parseTierSpecs(PERSONAL.specs)).toEqual({
      parallelAgents: 5,
      vcpus: 4,
      memoryMb: 8192,
      diskGb: 64,
      computeHours: 150,
      alwaysOn: false,
    });
  });

  test("alwaysOn false is a fact, not a missing field", () => {
    // The one field allowed to be falsy. Checking it for truth rather than for
    // type would drop the specs of four of the five tiers.
    expect(parseTierSpecs({ ...PERSONAL.specs, alwaysOn: false })?.alwaysOn).toBe(false);
    expect(parseTierSpecs({ ...PERSONAL.specs, alwaysOn: true })?.alwaysOn).toBe(true);
  });

  test("ONE missing field drops the whole spec block", () => {
    // Not five-sixths of a card. A spec card with a row quietly absent invites
    // the reader to assume the row they cannot see.
    for (const field of ["parallelAgents", "vcpus", "memoryMb", "diskGb", "computeHours", "alwaysOn"]) {
      const partial: Record<string, unknown> = { ...PERSONAL.specs };
      delete partial[field];
      expect(parseTierSpecs(partial)).toBeNull();
    }
  });

  test("zero, negative, NaN and stringified numbers are all refused", () => {
    // A "0 vCPU" machine and a `"4"` that renders as 4 are both worse than
    // saying nothing: they look exactly like real specs.
    expect(parseTierSpecs({ ...PERSONAL.specs, vcpus: 0 })).toBeNull();
    expect(parseTierSpecs({ ...PERSONAL.specs, diskGb: -64 })).toBeNull();
    expect(parseTierSpecs({ ...PERSONAL.specs, computeHours: Number.NaN })).toBeNull();
    expect(parseTierSpecs({ ...PERSONAL.specs, memoryMb: "8192" })).toBeNull();
    expect(parseTierSpecs({ ...PERSONAL.specs, alwaysOn: "true" })).toBeNull();
  });

  test("an empty object is not a spec", () => {
    // The contract says "all six fields or null". `{}` is the shape a server
    // reaches for when it means null, and it must not read as one.
    expect(parseTierSpecs({})).toBeNull();
    expect(parseTierSpecs(null)).toBeNull();
    expect(parseTierSpecs(undefined)).toBeNull();
  });
});

describe("the catalog the server sends", () => {
  test("no catalog and an empty catalog are different answers", () => {
    // null  → this control plane does not publish a catalog; fall back to the
    //         bundled product ids and show no specs.
    // []    → omg sells nothing right now; say so.
    // Collapsing these would make an old server look like a sold-out one.
    expect(parseCatalogTiers(undefined)).toBeNull();
    expect(parseCatalogTiers(null)).toBeNull();
    expect(parseCatalogTiers({ tiers: [] })).toBeNull();
    expect(parseCatalogTiers([])).toEqual([]);
  });

  test("order is preserved, because it is the ladder", () => {
    const tiers = parseCatalogTiers([
      { ...PERSONAL, plan: "computer_s20", label: "Starter" },
      PERSONAL,
      { ...PERSONAL, plan: "computer_20", label: "Always On" },
    ]);
    expect(tiers?.map((t) => t.label)).toEqual(["Starter", "Personal", "Always On"]);
  });

  test("a tier that cannot be bought or named is dropped", () => {
    const tiers = parseCatalogTiers([
      { plan: "computer_5", label: "Personal", specs: null }, // no productId
      { productId: "x", label: "Personal", specs: null }, // no plan key
      { productId: "x", plan: "computer_5", specs: null }, // no label
      PERSONAL,
    ]);
    expect(tiers).toHaveLength(1);
    expect(tiers?.[0]?.label).toBe("Personal");
  });

  test("a sellable tier with unusable specs still sells, it just says nothing", () => {
    // The degradation that matters: the row is still buyable at Apple's price,
    // and simply makes no claim about hardware.
    const tiers = parseCatalogTiers([{ ...PERSONAL, specs: { vcpus: 4 } }]);
    expect(tiers).toHaveLength(1);
    expect(tiers?.[0]?.specs).toBeNull();
  });
});

describe("the bundled fallback carries ids, never facts", () => {
  test("every fallback tier has a null spec", () => {
    // This is the invariant the whole design rests on. If someone ever pastes
    // the numbers back into store.ts to "make the offline case nicer", this
    // fails — and it should, because that copy cannot be drift-checked from
    // this repo and would eventually sell a machine nobody gets.
    for (const tier of FALLBACK_TIERS) {
      expect(tier.specs).toBeNull();
    }
  });

  test("the fallback still has enough to make a purchase attributable", () => {
    expect(FALLBACK_TIERS.length).toBeGreaterThan(0);
    for (const tier of FALLBACK_TIERS) {
      expect(tier.productId).toMatch(/^dev\.omg\.computer\./);
      expect(tier.plan).toBeTruthy();
      expect(tier.label).toBeTruthy();
    }
  });

  test("iOS sells Starter through Pro, and does not offer Always On", () => {
    // Benny's call. Enforced here rather than left to the accident that the
    // product does not exist in App Store Connect — StoreKit silently drops
    // ids it cannot find, so without this the list would look wrong and
    // behave right until someone created the product for a sandbox test.
    expect(FALLBACK_TIERS.map((tier) => tier.plan)).toEqual([
      "computer_s20",
      "computer_s40",
      "computer_5",
      "computer_10",
    ]);
  });

  test("but a server that DOES send Always On is still rendered", () => {
    // Not offering it is a merchandising decision, not a parser limit. If the
    // control plane ever publishes that rung again, this screen shows it
    // without a new build.
    const tiers = parseCatalogTiers([{ ...PERSONAL, plan: "computer_20", label: "Always On" }]);
    expect(tiers?.map((tier) => tier.label)).toEqual(["Always On"]);
  });

  test("no price string is compiled into the bundle", () => {
    // Apple's displayPrice is the only price this screen may render. Anything
    // that looks like money here is wrong in most of the world.
    for (const tier of FALLBACK_TIERS) {
      expect(JSON.stringify(tier)).not.toMatch(/[$€£¥]|\d+\s*\/\s*mo/);
    }
  });
});

describe("the words, which are copied from the dashboard on purpose", () => {
  test("hours read the way the web reads them", () => {
    expect(formatComputeHours(20)).toBe("20 hours");
    expect(formatComputeHours(750)).toBe("750 hours");
    expect(formatComputeHours(1.5)).toBe("1.5 hours");
  });

  test("a wallet that buys real time never rounds down to nothing", () => {
    // "0 hours" on a plan someone is about to pay for is a lie the rounding
    // would tell for us.
    expect(formatComputeHours(0.5)).toBe("30 min");
    expect(formatComputeHours(0)).toBe("None included");
  });

  test("memory and machine match the dashboard's spec card", () => {
    expect(formatMemory(4096)).toBe("4 GB");
    expect(formatMemory(36864)).toBe("36 GB");
    expect(formatMemory(512)).toBe("512 MB");
    expect(formatMachine({ ...PERSONAL.specs })).toBe("4 vCPU · 8 GB");
  });

  test("agents are pluralised", () => {
    expect(formatParallelAgents(1)).toBe("1 agent in parallel");
    expect(formatParallelAgents(24)).toBe("24 agents in parallel");
  });

  test("only the always-on rung mentions sleeping", () => {
    // Four identical "Yes" rows down a list of five is noise; the shared
    // behaviour is stated once under the list instead.
    expect(sleepsBetweenTasks({ ...PERSONAL.specs, alwaysOn: false })).toBeNull();
    expect(sleepsBetweenTasks({ ...PERSONAL.specs, alwaysOn: true })).toBe("Never");
  });
});
