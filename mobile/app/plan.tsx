/**
 * The paywall. The way out of `upgrade_required`, and the onboarding plan step.
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
 *
 * ── This layout ────────────────────────────────────────────────────────────
 *
 * Edge-flush hero, one compact list, one Continue button. Tapping a row
 * selects it. Continue buys the selected paid rung, or leaves on Free / Skip.
 * Always On is not a row. StoreKit product ids do not change.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  useWindowDimensions,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState, PrimaryButton } from "../src/components";
import { BrandMark } from "../src/omg/brand-mark";
import { PressableScale } from "../src/omg/motion";
import {
  COMPACT_PAID_PLANS,
  continueCtaLabel,
  defaultSelectedPlan,
  emphasizeParallel,
  formatAllowanceLine,
  FREE_PLAN_KEY,
  FREE_ROW,
  isPopularPlan,
  PAYWALL_HEADLINE,
  PAYWALL_SUBHEAD,
  PERSONAL_PLAN_KEY,
  sellOnPaywall,
  taglineForPlan,
} from "../src/omg/plan-copy";
import { FALLBACK_TIERS, labelForPlan } from "../src/omg/plan-specs";
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
  type StoreProduct,
  type StorePurchase,
  type Tier,
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

const SELECTED_FILL = "rgba(255, 85, 48, 0.08)";

export default function PlanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors, type, space, radius, isDark } = useTheme();
  const toast = useToast();
  const { refreshMachines } = useOmg();
  const pageBg = isDark ? colors.bg : "#ffffff";

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [account, setAccount] = useState<PurchaseAccount | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState(PERSONAL_PLAN_KEY);

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
   * omg first, Apple second — and that order is now forced.
   *
   * These two used to run in parallel, because neither is useful alone: the
   * token without products has nothing to buy, and products without the token
   * cannot be attributed to an account. They can no longer be parallel, because
   * omg's answer now contains the SKU LIST, and StoreKit has to be asked for
   * specific product ids. The server owning that list is the point (see
   * FALLBACK_TIERS) — it makes "an id the phone knows but the server doesn't"
   * unrepresentable rather than merely commented about.
   *
   * The latency that costs is bought back by starting `connectStore()`
   * alongside the omg call instead of before it. StoreKit's connection is the
   * slow half and it depends on nothing, so it now overlaps the round trip that
   * used to precede it.
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
      const [, purchaseAccount] = await Promise.all([connectStore(), fetchPurchaseAccount()]);
      setAccount(purchaseAccount);
      // A control plane that published no catalog leaves `tiers` null, and the
      // bundled ids stand in so the screen can still sell something. They carry
      // no specs, so the rows degrade to a name and Apple's price rather than
      // to numbers this build remembers — the whole reason the facts moved to
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
      const purchases = await restoreTiers(account?.tiers ?? FALLBACK_TIERS);
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
  }, [account, record, refreshMachines, toast]);

  const skip = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  // MOCK-ONLY. See the note on `params` above.
  useEffect(() => {
    if (!isMockStore || !params.auto || autoRan.current === scenarioKey) return;
    if (phase.kind !== "ready" || products.length === 0) return;
    autoRan.current = scenarioKey;
    if (params.auto === "restore") void restore();
    else void buy(products.find((p) => p.plan === PERSONAL_PLAN_KEY) ?? products[0]);
  }, [buy, params.auto, phase.kind, products, restore, scenarioKey]);

  const paidRows = useMemo(
    () =>
      COMPACT_PAID_PLANS.flatMap((plan) => {
        const product = products.find((entry) => entry.plan === plan);
        if (!product || !sellOnPaywall(product.plan, product.specs)) return [];
        return [product];
      }),
    [products],
  );

  useEffect(() => {
    if (paidRows.length === 0) return;
    setSelected(defaultSelectedPlan([FREE_PLAN_KEY, ...paidRows.map((row) => row.plan)]));
  }, [paidRows]);

  const busy = phase.kind === "purchasing" || phase.kind === "restoring";
  const currentPlan = phase.kind === "done" ? phase.entitlement.plan : account?.plan ?? null;
  /**
   * The tier list to NAME plans from. Not the same thing as `products`, which
   * is only what Apple will sell right now: a plan the account is already on
   * can be absent from the store (retired, or pulled from App Store Connect)
   * and still needs a name in "You're all set" and in the Stripe notice.
   */
  const catalog = account?.tiers ?? FALLBACK_TIERS;
  const selectedProduct = paidRows.find((row) => row.plan === selected);
  const choosing = phase.kind === "ready" || phase.kind === "purchasing" || phase.kind === "restoring";
  const ctaLabel = continueCtaLabel(
    selected === FREE_PLAN_KEY ? null : (selectedProduct?.displayPrice ?? null),
  );

  const continuePress = () => {
    if (selected === FREE_PLAN_KEY || selected === currentPlan) {
      skip();
      return;
    }
    if (selectedProduct) void buy(selectedProduct);
  };

  return (
    <View style={{ flex: 1, backgroundColor: pageBg }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      {isMockStore ? <MockBanner /> : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: space.lg }}
        showsVerticalScrollIndicator={false}
      >
        <PaywallHero fadeTo={pageBg} />

        <View style={{ alignItems: "center", marginTop: -36 }}>
          <BrandMark size={56} holeColor={pageBg} />
        </View>

        <Text
          style={{
            ...type.title,
            color: colors.text,
            textAlign: "center",
            paddingHorizontal: space.xl,
            marginTop: space.md,
          }}
        >
          {PAYWALL_HEADLINE}
        </Text>
        <Text
          style={{
            ...type.callout,
            color: colors.textMuted,
            textAlign: "center",
            paddingHorizontal: space.xl,
            marginTop: space.xs,
            marginBottom: space.lg,
          }}
        >
          {PAYWALL_SUBHEAD}
        </Text>

        {phase.kind === "loading" ? (
          <View style={{ paddingVertical: space.xxl, alignItems: "center", gap: space.md }}>
            <ActivityIndicator color={colors.textMuted} />
            <Text style={{ ...type.footnote, color: colors.textMuted }}>Loading plans…</Text>
          </View>
        ) : phase.kind === "unavailable" ? (
          <EmptyState title="Not available on this build" detail={phase.message} />
        ) : phase.kind === "done" ? (
          <Subscribed entitlement={phase.entitlement} catalog={catalog} />
        ) : phase.kind === "activating" ? (
          <Activating plan={phase.plan} catalog={catalog} />
        ) : (
          <>
            {loadError ? (
              <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.md }}>
                <Text style={{ ...type.footnote, color: colors.danger }}>{loadError}</Text>
                <PrimaryButton label="Try again" tone="quiet" onPress={() => void load()} />
              </View>
            ) : null}

            {/* canPurchase:false is a NORMAL state for an existing web customer,
                not an edge case — so it gets an explanation rather than a
                disabled button someone has to guess the meaning of. */}
            {account && !account.canPurchase ? (
              <AlreadySubscribed plan={account.plan} reason={account.reason} catalog={catalog} />
            ) : null}

            {paidRows.length > 0 || !loadError ? (
              <View
                style={{
                  marginHorizontal: space.lg,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: colors.borderSoft,
                  backgroundColor: isDark ? colors.card : "#ffffff",
                  overflow: "hidden",
                }}
              >
                <PlanRow
                  selected={selected === FREE_PLAN_KEY}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setSelected(FREE_PLAN_KEY);
                  }}
                  label={FREE_ROW.label}
                  tagline={FREE_ROW.tagline}
                  computeHours={FREE_ROW.computeHours}
                  parallelAgents={FREE_ROW.parallelAgents}
                  price={FREE_ROW.priceLabel}
                  last={paidRows.length === 0}
                />
                {paidRows.map((product, index) => (
                  <PlanRow
                    key={product.productId}
                    selected={selected === product.plan}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setSelected(product.plan);
                    }}
                    label={product.label}
                    tagline={taglineForPlan(product.plan)}
                    computeHours={product.specs?.computeHours}
                    parallelAgents={product.specs?.parallelAgents}
                    price={product.displayPrice}
                    popular={isPopularPlan(product.plan)}
                    current={currentPlan === product.plan}
                    last={index === paidRows.length - 1}
                  />
                ))}
              </View>
            ) : (
              <EmptyState
                title="No plans available"
                detail="The App Store didn't return any products. Try again in a moment."
              />
            )}

            <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.sm }}>
              <PressableScale onPress={() => void restore()} disabled={busy} hitSlop={8}>
                <Text
                  style={{
                    ...type.caption,
                    color: colors.textMuted,
                    textAlign: "center",
                    textDecorationLine: "underline",
                  }}
                >
                  {phase.kind === "restoring" ? "Restoring…" : "Restore purchases"}
                </Text>
              </PressableScale>
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
              <LegalLinks />
            </View>
          </>
        )}
      </ScrollView>

      {choosing ? (
        <View
          style={{
            paddingHorizontal: space.lg,
            paddingTop: space.sm,
            paddingBottom: Math.max(insets.bottom, space.md),
            backgroundColor: pageBg,
            gap: space.sm,
          }}
        >
          <PressableScale
            onPress={continuePress}
            disabled={
              busy ||
              (selected !== FREE_PLAN_KEY &&
                (!selectedProduct || !account?.canPurchase || selected === currentPlan))
            }
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}
            scale={0.98}
            style={{
              height: 52,
              borderRadius: radius.lg,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.brand,
              opacity:
                busy ||
                (selected !== FREE_PLAN_KEY &&
                  (!selectedProduct || !account?.canPurchase || selected === currentPlan))
                  ? 0.4
                  : 1,
            }}
          >
            {phase.kind === "purchasing" ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={{ ...type.headline, color: "#ffffff" }}>{ctaLabel}</Text>
            )}
          </PressableScale>
          <PressableScale onPress={skip} disabled={busy} hitSlop={10}>
            <Text style={{ ...type.callout, color: colors.textMuted, textAlign: "center" }}>
              Skip for now
            </Text>
          </PressableScale>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Edge-flush launch still. Square-ish, zoomed on the phone, fading into the
 * page.
 *
 * There is no clip asset in this repo or in the onboarding flow — no mp4, no
 * existing host URL. This is a still crop of the same frame the mock shows,
 * not a YouTube player and not a new video host.
 */
function PaywallHero({ fadeTo }: { fadeTo: string }) {
  const { width } = useWindowDimensions();
  const height = Math.round(width * 0.92);

  return (
    <View style={{ width, height, overflow: "hidden", backgroundColor: "#c8b7aa" }}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: -height * 0.08,
          left: -width * 0.12,
          width: width * 1.24,
          height: height * 1.2,
        }}
      >
        <LinearGradient
          colors={["#d9c7b8", "#c3b0a2", "#b19788"]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
        />
        <View
          style={{
            position: "absolute",
            width: width * 0.86,
            height: height * 1.05,
            left: width * 0.19,
            top: height * 0.1,
            borderRadius: 36,
            backgroundColor: "#111111",
            padding: 8,
            transform: [{ rotate: "-8deg" }],
          }}
        >
          <View
            style={{
              flex: 1,
              borderRadius: 28,
              backgroundColor: "#f4f4f5",
              overflow: "hidden",
              paddingTop: 18,
              paddingHorizontal: 12,
              gap: 8,
            }}
          >
            <View
              style={{
                alignSelf: "center",
                width: 48,
                height: 6,
                borderRadius: 3,
                backgroundColor: "#111",
                marginBottom: 8,
              }}
            />
            <FeedLine width="78%" />
            <FeedLine width="64%" />
            <FeedLine width="86%" />
            <FeedLine width="52%" />
          </View>
        </View>
      </View>
      <LinearGradient
        colors={["rgba(255,255,255,0)", fadeTo]}
        locations={[0.2, 1]}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.46 }}
      />
    </View>
  );
}

function FeedLine({ width }: { width: string }) {
  return (
    <View
      style={{
        height: 34,
        width,
        borderRadius: 10,
        backgroundColor: "#ffffff",
        borderWidth: 1,
        borderColor: "rgba(0,0,0,0.06)",
      }}
    />
  );
}

function PlanRow({
  selected,
  onPress,
  label,
  tagline,
  computeHours,
  parallelAgents,
  price,
  popular = false,
  current = false,
  last = false,
}: {
  selected: boolean;
  onPress: () => void;
  label: string;
  tagline?: string;
  computeHours?: number;
  parallelAgents?: number;
  price: string;
  popular?: boolean;
  current?: boolean;
  last?: boolean;
}) {
  const { colors, type, space } = useTheme();
  const allowance =
    computeHours != null && parallelAgents != null
      ? formatAllowanceLine(computeHours, parallelAgents)
      : null;
  const emphasize = parallelAgents != null && emphasizeParallel(parallelAgents);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={[
        label,
        popular ? "most popular" : "",
        current ? "current plan" : "",
        tagline ?? "",
        allowance
          ? `${allowance.hours} · ${allowance.parallelCount} ${allowance.parallelSuffix}`
          : "",
        price,
      ]
        .filter(Boolean)
        .join(". ")}
      scale={1}
      style={{
        backgroundColor: selected ? SELECTED_FILL : "transparent",
        paddingHorizontal: space.md,
        paddingVertical: 12,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.borderSoft,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
      }}
    >
      <Radio selected={selected} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text style={{ ...type.headline, color: colors.text }}>{label}</Text>
          {popular ? (
            <Text style={{ ...type.overline, color: colors.brand, fontSize: 10 }}>MOST POPULAR</Text>
          ) : null}
        </View>
        {tagline ? (
          <Text style={{ ...type.footnote, color: colors.textMuted }}>{tagline}</Text>
        ) : null}
        {allowance ? (
          <Text style={{ ...type.footnote, color: colors.textSecondary }}>
            {allowance.hours}
            {" · "}
            <Text
              style={{
                color: emphasize ? colors.brand : colors.textSecondary,
                fontWeight: emphasize ? "700" : "400",
              }}
            >
              {allowance.parallelCount}
            </Text>
            {" "}
            {allowance.parallelSuffix}
          </Text>
        ) : null}
      </View>
      <Text style={{ ...type.headline, color: colors.text }}>{price}</Text>
    </PressableScale>
  );
}

function Radio({ selected }: { selected: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: selected ? 0 : 1.5,
        borderColor: colors.borderStrong,
        backgroundColor: selected ? colors.brand : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {selected ? (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#ffffff" }} />
      ) : null}
    </View>
  );
}

/**
 * Functional Privacy Policy and Terms of Use links, on the purchase surface.
 *
 * Required, and worth sourcing precisely because it is easy to overstate.
 * Guideline 3.1.2(c) does not itself list link requirements — it says "Ensure
 * you clearly communicate the requirements described in Schedule 2 of the Apple
 * Developer Program License Agreement." Schedule 2 is where the functional
 * privacy policy and EULA links on a subscription surface actually come from.
 * It is one level below the guideline text, it is real, and missing links are
 * among the most commonly cited rejections for subscription apps.
 *
 * The word doing the work is FUNCTIONAL. Naming the documents is not enough;
 * these have to be tappable and they have to load. Both targets return 200.
 *
 * ── Not a 3.1.1(a) violation, for the same reason as settings.tsx ──────────
 *
 * This is the paywall, so an outbound link here looks even more alarming than
 * the account-deletion one. It is not a purchasing mechanism: it opens a legal
 * document, takes no money, and cannot be transacted against. 3.1.1(a) is about
 * calls to action directing customers to OTHER WAYS TO PAY. Schedule 2 requires
 * these on the very screen 3.1.1(a) governs, so the rules are not merely
 * compatible — Apple expects both at once. Do not remove them to "clean up the
 * paywall".
 *
 * Deliberately omg.dev, not app.omg.dev: these are public legal documents, not
 * dashboard surfaces, and a reviewer must be able to open them signed out.
 */
function LegalLinks() {
  const { colors, type, space } = useTheme();
  const open = (path: string) => void Linking.openURL(`https://omg.dev${path}`);
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", gap: space.lg }}>
      <PressableScale onPress={() => open("/privacy")} hitSlop={12}>
        <Text style={{ ...type.caption, color: colors.textMuted, textDecorationLine: "underline" }}>
          Privacy Policy
        </Text>
      </PressableScale>
      <PressableScale onPress={() => open("/terms")} hitSlop={12}>
        <Text style={{ ...type.caption, color: colors.textMuted, textDecorationLine: "underline" }}>
          Terms of Use
        </Text>
      </PressableScale>
    </View>
  );
}

/**
 * Apple has the money, omg has not confirmed yet.
 *
 * Deliberately reassuring and deliberately not an error. The transaction is
 * still in StoreKit's queue, so this resolves itself on next launch even if the
 * person kills the app right now.
 */
function Activating({ plan, catalog }: { plan: string; catalog: readonly Tier[] }) {
  const { colors, type, space } = useTheme();
  const label = labelForPlan(plan, catalog);
  return (
    <View style={{ paddingTop: space.lg }}>
      <EmptyState
        title="Purchase complete"
        detail={`Your ${label ?? "new"} plan is being activated. This usually takes a few seconds — you can close this screen, it will finish on its own.`}
      />
      <View style={{ alignItems: "center", gap: space.sm }}>
        <ActivityIndicator color={colors.textMuted} />
        <Text style={{ ...type.caption, color: colors.textMuted }}>Activating…</Text>
      </View>
    </View>
  );
}

function Subscribed({
  entitlement,
  catalog,
}: {
  entitlement: Entitlement;
  catalog: readonly Tier[];
}) {
  const { space } = useTheme();
  // Falls back to the raw plan key on purpose. The server can name a plan this
  // build has never heard of — a grandfathered rung, or one added after the
  // binary shipped — and "computer_early" is ugly but true, where a guessed
  // label would be neither.
  const label = labelForPlan(entitlement.plan, catalog) ?? entitlement.plan;
  return (
    <View style={{ paddingTop: space.lg }}>
      <EmptyState
        title={entitlement.replayed ? "Purchases restored" : "You're all set"}
        detail={`Your cloud computer is on ${label}. It may take a moment to come back online.`}
      />
    </View>
  );
}

/**
 * Already paying, through the web.
 *
 * Buying again here would double-bill: Apple would take the money and omg would
 * owe a refund. So this states the situation plainly.
 *
 * ── Every word here is load-bearing ────────────────────────────────────────
 *
 * It states a FACT about the account and issues no instruction. There is no
 * link, no URL, no button, and no verb aimed at the reader — not "go to", not
 * "manage it at", not "visit". 3.1.1(a) prohibits calls to action pointing at a
 * purchasing mechanism other than in-app purchase outside the US storefront,
 * and #114 removed `"Fix this on omg.dev"` for exactly that reason even though
 * it too only opened the dashboard root. Telling someone where their existing
 * billing already lives is not a call to action; telling them to go there is.
 * Do not add a link to this component.
 *
 * The second sentence stays because the first alone does not explain why the
 * rows below cannot be bought, and an unexplained dead control is what #115
 * set out to avoid. It describes this screen's own behaviour, not somewhere
 * else's.
 */
function AlreadySubscribed({
  plan,
  reason,
  catalog,
}: {
  plan?: string | null;
  reason?: string | null;
  catalog: readonly Tier[];
}) {
  const { colors, type, space } = useTheme();
  const label = labelForPlan(plan, catalog);
  const stripe = reason === "stripe_subscription_active";
  return (
    <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
      <View
        style={{
          backgroundColor: SELECTED_FILL,
          borderRadius: 12,
          padding: space.lg,
          gap: space.xs,
        }}
      >
        <Text style={{ ...type.callout, color: colors.text, fontWeight: "600" }}>
          {stripe ? "You're subscribed through omg.dev on the web" : "Purchases are unavailable"}
        </Text>
        <Text style={{ ...type.footnote, color: colors.textSecondary, lineHeight: 18 }}>
          {stripe
            ? `${label ? `Your ${label} plan is` : "This account is"} billed on the web, not through the App Store. Buying again here would charge you twice, so it's turned off.`
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
