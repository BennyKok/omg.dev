/**
 * Buying and restoring a plan. ONE implementation, two screens.
 *
 * `app/plan.tsx` owned all of this, and then the onboarding revamp added a
 * second paywall as step 06. A second copy of money code is the worst possible
 * duplication: the rules below are not obvious, they are each the result of a
 * specific failure, and a copy drifts silently because a purchase cannot be
 * exercised in CI or on a simulator. So the machinery lives here and the two
 * screens are only pixels.
 *
 * Everything load-bearing is spelled out in app/plan.tsx's header and in the
 * comments below. The short version, because it decides what this may say:
 *
 *  - The device is never the authority on what somebody paid for. Apple sells;
 *    omg decides what that entitles you to.
 *  - Once StoreKit says a purchase completed, the money is gone and the
 *    entitlement is coming. A failed submit to omg is a SLOW ACTIVATION, not a
 *    failed payment, and nothing below the purchase line may say "failed".
 *  - A cancellation is a decision, not an error. Do not shout about it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";

import {
  BillingError,
  fetchPurchaseAccount,
  submitSignedTransaction,
  type Entitlement,
  type PurchaseAccount,
} from "./billing";
import { FALLBACK_TIERS } from "./plan-specs";
import { useOmg } from "./provider";
import {
  connectStore,
  fetchTiers,
  finishPurchase,
  isStoreAvailable,
  purchaseTier,
  restoreTiers,
  StoreError,
  type StoreProduct,
  type StorePurchase,
} from "./store";
import { useToast } from "./toast";

/**
 * What the flow is doing, as ONE value.
 *
 * A discriminated state rather than a handful of booleans, because several of
 * these are mutually exclusive in ways booleans do not enforce -- `purchasing`
 * and `activating` in particular, where showing both at once would put a
 * spinner on a row whose purchase has already completed.
 */
export type PurchasePhase =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready" }
  | { kind: "purchasing"; productId: string }
  | { kind: "restoring" }
  /** Apple took the payment; omg has not confirmed yet. NOT an error. */
  | { kind: "activating"; plan: string }
  | { kind: "done"; entitlement: Entitlement };

export type PurchaseFlow = {
  phase: PurchasePhase;
  account: PurchaseAccount | null;
  products: StoreProduct[];
  loadError: string | null;
  busy: boolean;
  buy: (product: StoreProduct) => Promise<void>;
  restore: () => Promise<void>;
  reload: () => Promise<void>;
};

type Catalog = { account: PurchaseAccount; products: StoreProduct[] };

/**
 * The catalog, fetched ahead of the screen that shows it.
 *
 * Onboarding's pricing page used to open on a spinner and an empty table for
 * about 2 s while omg and then StoreKit answered (Benny, 2026-09-24: no
 * waiting inside the flow). The working screen before it has seconds to
 * spare, so step 04 starts this load and the pricing page picks it up.
 *
 * Used once, then dropped: a later reload, a restore or a purchase always
 * asks again. Five minutes bounds how old a price or a purchase token can be.
 */
const WARM_MS = 5 * 60_000;
let warm: { at: number; promise: Promise<Catalog>; value?: Catalog } | null = null;

async function loadCatalog(): Promise<Catalog> {
  const [, account] = await Promise.all([connectStore(), fetchPurchaseAccount()]);
  // See `reload` below for why the bundled ids stand in for a null catalog.
  const products = await fetchTiers(account.tiers ?? FALLBACK_TIERS);
  return { account, products };
}

function freshWarm() {
  return warm && Date.now() - warm.at < WARM_MS ? warm : null;
}

/** Start loading plans now, for a pricing screen that is about to appear. */
export function prefetchPurchaseCatalog(): void {
  if (!isStoreAvailable() || freshWarm()) return;
  const entry: NonNullable<typeof warm> = { at: Date.now(), promise: loadCatalog() };
  entry.promise.then(
    (value) => {
      entry.value = value;
    },
    () => {
      // A failed prefetch is forgotten; the screen loads for itself.
      if (warm === entry) warm = null;
    },
  );
  warm = entry;
}

export function usePurchaseFlow(
  /**
   * Mock-only. Changing it reloads, so a deep link with a new scenario does
   * not keep the previous result. Inert in a release build, which cannot turn
   * mock mode on.
   */
  scenarioKey = "",
): PurchaseFlow {
  const toast = useToast();
  const { refreshMachines } = useOmg();
  // A prefetch that already finished paints the table on the first frame.
  const [ready] = useState(() => (scenarioKey === "" ? freshWarm()?.value ?? null : null));
  const [phase, setPhase] = useState<PurchasePhase>(ready ? { kind: "ready" } : { kind: "loading" });
  const [account, setAccount] = useState<PurchaseAccount | null>(ready?.account ?? null);
  const [products, setProducts] = useState<StoreProduct[]>(ready?.products ?? []);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * omg first, Apple second -- and that order is forced.
   *
   * These two used to run in parallel, because neither is useful alone: the
   * token without products has nothing to buy, and products without the token
   * cannot be attributed to an account. They can no longer be parallel,
   * because omg's answer now contains the SKU LIST, and StoreKit has to be
   * asked for specific product ids. The server owning that list is the point
   * (see FALLBACK_TIERS): it makes "an id the phone knows but the server does
   * not" unrepresentable rather than merely commented about.
   *
   * The latency that costs is bought back by starting `connectStore()`
   * alongside the omg call instead of before it. StoreKit's connection is the
   * slow half and it depends on nothing, so it overlaps the round trip that
   * used to precede it.
   */
  const reload = useCallback(async () => {
    setLoadError(null);
    // Take a prefetch once: mock scenarios never use it, and it is dropped
    // here so any later reload asks the store again.
    const prefetched = scenarioKey === "" ? freshWarm() : null;
    warm = null;
    if (prefetched) {
      try {
        const catalog = prefetched.value ?? (await prefetched.promise);
        setAccount(catalog.account);
        setProducts(catalog.products);
        setPhase({ kind: "ready" });
        return;
      } catch {
        // Fall through to a load of its own.
      }
    }
    setPhase({ kind: "loading" });

    if (!isStoreAvailable()) {
      // The honest message for a build without the native module -- which is
      // every build that predates this feature, since IAP cannot ship over the
      // air. Not an error state; there is simply no store here.
      setPhase({
        kind: "unavailable",
        message: "Update omg from the App Store to manage your plan on this device.",
      });
      return;
    }

    try {
      const [, purchaseAccount] = await Promise.all([connectStore(), fetchPurchaseAccount()]);
      setAccount(purchaseAccount);
      // A control plane that published no catalog leaves `tiers` null, and the
      // bundled ids stand in so the screen can still sell something. They carry
      // no specs, so the cards degrade to a name and Apple's price rather than
      // to numbers this build remembers -- the whole reason the facts moved to
      // the server. Null and [] are different answers: [] means omg genuinely
      // sells nothing right now, and is passed through as an empty list.
      setProducts(await fetchTiers(purchaseAccount.tiers ?? FALLBACK_TIERS));
      setPhase({ kind: "ready" });
    } catch (error) {
      setLoadError(
        error instanceof BillingError || error instanceof StoreError
          ? error.message
          : "Couldn't load plans. Pull to try again.",
      );
      setPhase({ kind: "ready" });
    }
  }, [scenarioKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Record a signed transaction with omg.
   *
   * Returns the entitlement, or null when the submit failed. Null is NOT an
   * error the caller should report as a failed purchase -- see the header.
   */
  const record = useCallback(async (purchase: StorePurchase): Promise<Entitlement | null> => {
    try {
      const entitlement = await submitSignedTransaction(purchase.signedTransaction);
      // Only now is it safe to finish: omg has it, so Apple no longer needs to
      // replay it.
      await finishPurchase(purchase);
      return entitlement;
    } catch {
      // Left unfinished on purpose. StoreKit re-delivers it on next launch and
      // it gets recorded then, which is the recovery path for a dropped
      // connection or a backgrounded app.
      return null;
    }
  }, []);

  const buy = useCallback(
    async (product: StoreProduct) => {
      if (!account?.appAccountToken) return;
      void Haptics.selectionAsync();
      setPhase({ kind: "purchasing", productId: product.productId });

      let purchase: StorePurchase;
      try {
        purchase = await purchaseTier(product.productId, account.appAccountToken);
      } catch (error) {
        setPhase({ kind: "ready" });
        // A cancellation is a decision, not a failure. Shouting about it is
        // the classic paywall tell.
        if (error instanceof StoreError && error.cancelled) return;
        toast.show(
          error instanceof Error ? error.message : "Your purchase could not be completed.",
          { intent: "error" },
        );
        return;
      }

      // Past this line Apple has charged them. Nothing below may say "failed".
      const entitlement = await record(purchase);
      if (!entitlement) {
        setPhase({ kind: "activating", plan: product.plan });
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhase({ kind: "done", entitlement });
      // The blocked computer is the reason anyone is on the paywall, so
      // refresh it rather than leaving a stale "used up" behind the sheet.
      void refreshMachines();
    },
    [account, record, refreshMachines, toast],
  );

  /**
   * Apple requires a restore path. It also doubles as the manual repair for a
   * purchase whose submit never landed, which is why it re-submits rather than
   * only reading local state.
   */
  const restore = useCallback(async () => {
    setPhase({ kind: "restoring" });
    try {
      const purchases = await restoreTiers(account?.tiers ?? FALLBACK_TIERS);
      if (purchases.length === 0) {
        setPhase({ kind: "ready" });
        toast.show("No purchases to restore on this Apple ID.", { intent: "info" });
        return;
      }
      let restored: Entitlement | null = null;
      for (const purchase of purchases) {
        const entitlement = await record(purchase);
        // The active one wins; a lapsed subscription should not overwrite it.
        if (entitlement && (!restored || entitlement.status === "active")) restored = entitlement;
      }
      if (!restored) {
        setPhase({ kind: "ready" });
        toast.show("Couldn't reach omg to restore. Try again in a moment.", { intent: "error" });
        return;
      }
      setPhase({ kind: "done", entitlement: restored });
      void refreshMachines();
    } catch (error) {
      setPhase({ kind: "ready" });
      toast.show(error instanceof Error ? error.message : "Couldn't restore purchases.", {
        intent: "error",
      });
    }
  }, [account, record, refreshMachines, toast]);

  return {
    phase,
    account,
    products,
    loadError,
    busy: phase.kind === "purchasing" || phase.kind === "restoring",
    buy,
    restore,
    reload,
  };
}

/**
 * MOCK-ONLY helper for the deep-link auto-run in app/plan.tsx. It calls the
 * SAME buy()/restore() a tap calls; only the finger is missing.
 */
export function useAutoRun(
  flow: PurchaseFlow,
  auto: string | undefined,
  scenarioKey: string,
  enabled: boolean,
): void {
  /** Which scenario already ran, so a NEW deep link re-runs but a re-render does not. */
  const ran = useRef("");
  useEffect(() => {
    if (!enabled || !auto || ran.current === scenarioKey) return;
    if (flow.phase.kind !== "ready" || flow.products.length === 0) return;
    ran.current = scenarioKey;
    if (auto === "restore") void flow.restore();
    else void flow.buy(flow.products.find((p) => p.plan === "computer_5") ?? flow.products[0]);
  }, [auto, enabled, flow, scenarioKey]);
}
