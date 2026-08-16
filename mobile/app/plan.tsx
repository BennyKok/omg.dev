/**
 * The paywall. The way out of `upgrade_required`.
 *
 * "Included computer time is used up" was a dead end BY DESIGN. app/computers.tsx
 * states that fact and offers nothing, because the only thing it could have
 * offered was a link to web checkout, and App Review Guideline 3.1.1(a)
 * prohibits calls to action pointing at a purchasing mechanism other than
 * in-app purchase outside the US storefront. Three such links were removed for
 * exactly that reason (see the header of app/settings.tsx). This screen is what
 * makes the dead end a door — the in-app purchase those links were removed in
 * favour of, not a companion to them. NOTHING HERE MAY LINK TO WEB CHECKOUT.
 *
 * ── The one rule ───────────────────────────────────────────────────────────
 *
 * The device is never the authority on what someone has paid for. Apple sells;
 * omg decides what that entitles you to. So this screen renders `displayPrice`
 * straight from StoreKit and `plan` straight from omg, and computes neither.
 *
 * ── Why a completed purchase is never reported as failed ───────────────────
 *
 * Submitting the signed transaction to omg is a LATENCY OPTIMISATION. Apple's
 * server-to-server notification is the real entitlement path and lands whether
 * or not the app is running. So once StoreKit says the purchase completed, the
 * money is gone and the entitlement is coming; a failed submit is a slow
 * activation, not a failed payment.
 *
 * Telling someone their payment failed when Apple has already charged them is
 * the worst string this screen could ship — they retry, and either Apple blocks
 * the duplicate (confusing) or they believe they were charged twice (support).
 * Hence the `activating` state. The transaction is also deliberately NOT
 * finished in that case, so StoreKit replays it on next launch and it gets
 * recorded then.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, EmptyState, Icon, PrimaryButton, Row, SectionLabel, Separator } from "../src/components";
import { Text } from "../src/omg/text";
import { useTheme } from "../src/omg/theme";
import { useToast } from "../src/omg/toast";
import { useOmg } from "../src/omg/provider";
import {
  BillingError,
  fetchPurchaseAccount,
  setMockBillingScenario,
  submitSignedTransaction,
  type Entitlement,
  type PurchaseAccount,
} from "../src/omg/billing";
import {
  connectStore,
  fetchTiers,
  finishPurchase,
  isMockStore,
  isStoreAvailable,
  purchaseTier,
  restoreTiers,
  setMockScenario,
  StoreError,
  tierForPlan,
  type StoreProduct,
  type StorePurchase,
} from "../src/omg/store";

/**
 * What the screen is doing, as ONE value.
 *
 * Kept as a single discriminated state rather than a handful of booleans
 * because several of these are mutually exclusive in ways booleans do not
 * enforce — `purchasing` and `activating` in particular, where showing both at
 * once would put a spinner on a row whose purchase has already completed.
 */
type Phase =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "ready" }
  | { kind: "purchasing"; productId: string }
  | { kind: "restoring" }
  /** Apple took the payment; omg has not confirmed yet. NOT an error. */
  | { kind: "activating"; plan: string }
  | { kind: "done"; entitlement: Entitlement };

export default function PlanScreen() {
  const insets = useSafeAreaInsets();
  const { colors, type, space } = useTheme();
  const toast = useToast();
  const { refreshMachines } = useOmg();

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [account, setAccount] = useState<PurchaseAccount | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * MOCK-ONLY: pick a scenario, and optionally run the flow, from the deep link
   * — `omg://plan?mock=submitfail&auto=buy`.
   *
   * This exists because the states that matter most here are the ones that only
   * appear MID-FLOW: the spinner on a row, "purchase complete, activating", a
   * restored subscription. Screenshotting those needs the flow to actually run,
   * and on this setup the simulator cannot be tapped remotely (the Mac's
   * privacy settings block ssh-driven UI automation). Rather than assert those
   * states render correctly without looking — the exact mistake mobile/AGENTS.md
   * opens by warning about — `auto` calls the SAME buy()/restore() a tap calls.
   * Nothing is short-circuited; only the finger is missing.
   *
   * Inert unless mock mode is on, which a release build cannot turn on.
   */
  const params = useLocalSearchParams<{ mock?: string; auto?: string }>();
  if (isMockStore && params.mock) {
    setMockScenario(params.mock);
    setMockBillingScenario(params.mock);
  }
  /** Which scenario already ran, so a NEW deep link re-runs but a re-render does not. */
  const autoRan = useRef("");
  const scenarioKey = `${params.mock ?? ""}:${params.auto ?? ""}`;

  /**
   * Both sides, in parallel, because neither is useful alone: the token without
   * products has nothing to buy, and products without the token cannot be
   * attributed to an account.
   */
  const load = useCallback(async () => {
    setLoadError(null);
    setPhase({ kind: "loading" });

    if (!isStoreAvailable()) {
      // The honest message for a build without the native module — which is
      // every build that predates this feature, since IAP cannot ship over the
      // air. Not an error state; there is simply no store here.
      setPhase({
        kind: "unavailable",
        message: "Update omg from the App Store to manage your plan on this device.",
      });
      return;
    }

    try {
      await connectStore();
      const [purchaseAccount, tiers] = await Promise.all([fetchPurchaseAccount(), fetchTiers()]);
      setAccount(purchaseAccount);
      setProducts(tiers);
      setPhase({ kind: "ready" });
    } catch (error) {
      setLoadError(
        error instanceof BillingError || error instanceof StoreError
          ? error.message
          : "Couldn't load plans. Pull to try again.",
      );
      setPhase({ kind: "ready" });
    }
    // scenarioKey is a mock-only dependency: re-opening the deep link with a
    // different scenario has to reload rather than keep the previous result.
  }, [scenarioKey]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Record a signed transaction with omg.
   *
   * Returns the entitlement, or null when the submit failed. Null is NOT an
   * error the caller should report as a failed purchase — see the header.
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
      // The blocked computer is the reason anyone is on this screen, so refresh
      // it rather than leaving a stale "used up" behind the sheet.
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
      const purchases = await restoreTiers();
      if (purchases.length === 0) {
        setPhase({ kind: "ready" });
        toast.show("No purchases to restore on this Apple ID.");
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
  }, [record, refreshMachines, toast]);

  // MOCK-ONLY. See the note on `params` above.
  useEffect(() => {
    if (!isMockStore || !params.auto || autoRan.current === scenarioKey) return;
    if (phase.kind !== "ready" || products.length === 0) return;
    autoRan.current = scenarioKey;
    if (params.auto === "restore") void restore();
    else void buy(products.find((p) => p.plan === "computer_5") ?? products[0]);
  }, [buy, params.auto, phase.kind, products, restore, scenarioKey]);

  const busy = phase.kind === "purchasing" || phase.kind === "restoring";
  const currentPlan = phase.kind === "done" ? phase.entitlement.plan : account?.plan ?? null;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
      contentInsetAdjustmentBehavior="automatic"
    >
      {isMockStore ? <MockBanner /> : null}

      {phase.kind === "loading" ? (
        <View style={{ paddingVertical: space.xxl * 2, alignItems: "center", gap: space.md }}>
          <ActivityIndicator color={colors.textMuted} />
          <Text style={{ ...type.footnote, color: colors.textMuted }}>Loading plans…</Text>
        </View>
      ) : phase.kind === "unavailable" ? (
        <EmptyState title="Not available on this build" detail={phase.message} />
      ) : phase.kind === "done" ? (
        <Subscribed entitlement={phase.entitlement} />
      ) : phase.kind === "activating" ? (
        <Activating plan={phase.plan} />
      ) : (
        <>
          <Text
            style={{
              ...type.footnote,
              color: colors.textMuted,
              paddingHorizontal: space.lg,
              paddingTop: space.md,
              lineHeight: 18,
            }}
          >
            Your cloud computer runs on a monthly plan. Pick the size you need — you can change
            or cancel it any time in the App Store.
          </Text>

          {loadError ? (
            <View style={{ padding: space.lg, gap: space.md }}>
              <Text style={{ ...type.footnote, color: colors.danger }}>{loadError}</Text>
              <PrimaryButton label="Try again" tone="quiet" onPress={() => void load()} />
            </View>
          ) : null}

          {/* canPurchase:false is a NORMAL state for an existing web customer,
              not an edge case — so it gets an explanation rather than a
              disabled button someone has to guess the meaning of. */}
          {account && !account.canPurchase ? (
            <AlreadySubscribed plan={account.plan} reason={account.reason} />
          ) : null}

          {products.length > 0 ? (
            <>
              <SectionLabel>Computer plans</SectionLabel>
              <Card>
                {products.map((product, i) => {
                  const isCurrent = currentPlan === product.plan;
                  const purchasing =
                    phase.kind === "purchasing" && phase.productId === product.productId;
                  return (
                    <View key={product.productId}>
                      {/* Plain padding, not "text" mode: these rows have no
                          leading dot or icon, so their text is already flush
                          with the card's padding. See Separator's note. */}
                      {i > 0 ? <Separator inset={space.lg} /> : null}
                      <Row
                        disabled={busy || !account?.canPurchase || isCurrent}
                        onPress={() => void buy(product)}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text
                            style={{ ...type.callout, color: colors.text, fontWeight: "600" }}
                          >
                            {product.label}
                          </Text>
                          <Text style={{ ...type.footnote, color: colors.textMuted, lineHeight: 18 }}>
                            {product.detail}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 2, marginLeft: space.sm }}>
                          {purchasing ? (
                            <ActivityIndicator color={colors.textMuted} />
                          ) : isCurrent ? (
                            <Icon
                              ios="checkmark"
                              android="check"
                              size={16}
                              weight="semibold"
                              color={colors.primary}
                            />
                          ) : (
                            <>
                              {/* Apple's string, verbatim. Never composed here —
                                  it is a different currency in every storefront. */}
                              <Text
                                style={{ ...type.callout, color: colors.text, fontWeight: "600" }}
                              >
                                {product.displayPrice}
                              </Text>
                              <Text style={{ ...type.caption, color: colors.textMuted }}>
                                per month
                              </Text>
                            </>
                          )}
                        </View>
                      </Row>
                    </View>
                  );
                })}
              </Card>
            </>
          ) : !loadError ? (
            <EmptyState
              title="No plans available"
              detail="The App Store didn't return any products. Try again in a moment."
            />
          ) : null}

          <View style={{ paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.md }}>
            <PrimaryButton
              label="Restore purchases"
              tone="quiet"
              loading={phase.kind === "restoring"}
              disabled={busy}
              onPress={() => void restore()}
            />
            <Text
              style={{
                ...type.caption,
                color: colors.textMuted,
                textAlign: "center",
                lineHeight: 16,
              }}
            >
              Payment is charged to your Apple ID. Subscriptions renew monthly until cancelled in
              the App Store.
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

/**
 * Apple has the money, omg has not confirmed yet.
 *
 * Deliberately reassuring and deliberately not an error. The transaction is
 * still in StoreKit's queue, so this resolves itself on next launch even if the
 * person kills the app right now.
 */
function Activating({ plan }: { plan: string }) {
  const { colors, type, space } = useTheme();
  const tier = tierForPlan(plan);
  return (
    <View style={{ paddingTop: space.xxl }}>
      <EmptyState
        title="Purchase complete"
        detail={`Your ${tier?.label ?? "new"} plan is being activated. This usually takes a few seconds — you can close this screen, it will finish on its own.`}
      />
      <View style={{ alignItems: "center", gap: space.sm }}>
        <ActivityIndicator color={colors.textMuted} />
        <Text style={{ ...type.caption, color: colors.textMuted }}>Activating…</Text>
      </View>
    </View>
  );
}

function Subscribed({ entitlement }: { entitlement: Entitlement }) {
  const { space } = useTheme();
  const tier = tierForPlan(entitlement.plan);
  return (
    <View style={{ paddingTop: space.xxl }}>
      <EmptyState
        title={entitlement.replayed ? "Purchases restored" : "You're all set"}
        detail={`Your cloud computer is on ${tier?.label ?? entitlement.plan}. It may take a moment to come back online.`}
      />
    </View>
  );
}

/**
 * Already paying, through the web.
 *
 * Buying again here would double-bill: Apple would take the money and omg would
 * owe a refund. So this states the situation plainly. It deliberately does NOT
 * link anywhere to manage the Stripe subscription — that would be a call to
 * action pointing at an external purchasing mechanism, which is the exact thing
 * 3.1.1(a) prohibits and the reason this screen exists at all.
 */
function AlreadySubscribed({ plan, reason }: { plan?: string | null; reason?: string | null }) {
  const { colors, type, space } = useTheme();
  const tier = tierForPlan(plan);
  const stripe = reason === "stripe_subscription_active";
  return (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>
      <View
        style={{
          backgroundColor: colors.accentSoft,
          borderRadius: 12,
          padding: space.lg,
          gap: space.xs,
        }}
      >
        <Text style={{ ...type.callout, color: colors.text, fontWeight: "600" }}>
          {stripe ? "You already have a subscription" : "Purchases are unavailable"}
        </Text>
        <Text style={{ ...type.footnote, color: colors.textSecondary, lineHeight: 18 }}>
          {stripe
            ? `This account is already subscribed${tier ? ` on ${tier.label}` : ""} and billed outside the App Store. Buying here would charge you twice, so it's turned off.`
            : "This account can't purchase right now. Try again in a moment."}
        </Text>
      </View>
    </View>
  );
}

/** Loud on purpose. This must never be mistaken for a real purchase flow. */
function MockBanner() {
  const { colors, type, space } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.warning,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
      }}
    >
      <Text style={{ ...type.caption, color: "#000", fontWeight: "700" }}>
        MOCK STORE — fake prices, no real purchase
      </Text>
    </View>
  );
}
