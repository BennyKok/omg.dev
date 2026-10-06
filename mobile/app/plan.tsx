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

import { ActivityIndicator, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState, PrimaryButton } from "../src/components";
import { Text } from "../src/omg/text";
import { useTheme } from "../src/omg/theme";
import { PlanPicker } from "../src/omg/plan-picker";
import { setMockBillingScenario, type Entitlement } from "../src/omg/billing";
import { FALLBACK_TIERS, labelForPlan } from "../src/omg/plan-specs";
import { useAutoRun, usePurchaseFlow } from "../src/omg/purchase-flow";
import {
  isMockStore,
  setMockScenario,
  type StoreProduct,
  type Tier,
} from "../src/omg/store";

export default function PlanScreen() {
  const insets = useSafeAreaInsets();
  const { colors, type, space } = useTheme();

  /**
   * MOCK-ONLY: pick a scenario, and optionally run the flow, from the deep link
   * -- `omg://plan?mock=submitfail&auto=buy`.
   *
   * This exists because the states that matter most here are the ones that only
   * appear MID-FLOW: the spinner on a row, "purchase complete, activating", a
   * restored subscription. Screenshotting those needs the flow to actually run,
   * and on this setup the simulator cannot be tapped remotely (the Mac's
   * privacy settings block ssh-driven UI automation). Rather than assert those
   * states render correctly without looking -- the exact mistake mobile/AGENTS.md
   * opens by warning about -- `auto` calls the SAME buy()/restore() a tap calls.
   * Nothing is short-circuited; only the finger is missing.
   *
   * Inert unless mock mode is on, which a release build cannot turn on.
   */
  const params = useLocalSearchParams<{ mock?: string; auto?: string }>();
  if (isMockStore && params.mock) {
    setMockScenario(params.mock);
    setMockBillingScenario(params.mock);
  }
  const scenarioKey = `${params.mock ?? ""}:${params.auto ?? ""}`;

  /*
   * The buying itself belongs to src/omg/purchase-flow.ts, shared with the
   * onboarding paywall (step 06). This file is the screen, not the till.
   */
  const flow = usePurchaseFlow(scenarioKey);
  const { phase, account, products, loadError, buy, restore } = flow;
  const load = flow.reload;
  useAutoRun(flow, params.auto, scenarioKey, isMockStore);

  const busy = phase.kind === "purchasing" || phase.kind === "restoring";
  const currentPlan =
    phase.kind === "done" ? phase.entitlement.plan : (account?.plan ?? null);
  /**
   * The tier list to NAME plans from. Not the same thing as `products`, which
   * is only what Apple will sell right now: a plan the account is already on
   * can be absent from the store (retired, or pulled from App Store Connect)
   * and still needs a name in "You're all set" and in the Stripe notice.
   */
  const catalog = account?.tiers ?? FALLBACK_TIERS;

  if (
    phase.kind !== "loading" &&
    phase.kind !== "unavailable" &&
    phase.kind !== "done" &&
    phase.kind !== "activating"
  ) {
    return (
      <View style={{ flex: 1 }}>
        {isMockStore ? <MockBanner /> : null}
        <PlanPicker
          products={products}
          currentPlan={currentPlan}
          busy={busy}
          canPurchase={!!account?.canPurchase}
          onBuy={(product) => void buy(product)}
          onRestore={() => void restore()}
          restoring={phase.kind === "restoring"}
          notice={
            <>
              {loadError ? (
                <View style={{ gap: space.md }}>
                  <Text style={{ ...type.footnote, color: colors.danger }}>
                    {loadError}
                  </Text>
                  <PrimaryButton
                    label="Try again"
                    tone="quiet"
                    onPress={() => void load()}
                  />
                </View>
              ) : null}
              {account && !account.canPurchase ? (
                <AlreadySubscribed
                  plan={account.plan}
                  reason={account.reason}
                  catalog={catalog}
                />
              ) : null}
            </>
          }
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
      contentInsetAdjustmentBehavior="automatic"
    >
      {isMockStore ? <MockBanner /> : null}

      {phase.kind === "loading" ? (
        <View
          style={{
            paddingVertical: space.xxl * 2,
            alignItems: "center",
            gap: space.md,
          }}
        >
          <ActivityIndicator color={colors.textMuted} />
          <Text style={{ ...type.footnote, color: colors.textMuted }}>
            Loading plans…
          </Text>
        </View>
      ) : phase.kind === "unavailable" ? (
        <EmptyState
          title="Not available on this build"
          detail={phase.message}
        />
      ) : phase.kind === "done" ? (
        <Subscribed entitlement={phase.entitlement} catalog={catalog} />
      ) : phase.kind === "activating" ? (
        <Activating plan={phase.plan} catalog={catalog} />
      ) : null}
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
function Activating({
  plan,
  catalog,
}: {
  plan: string;
  catalog: readonly Tier[];
}) {
  const { colors, type, space } = useTheme();
  const label = labelForPlan(plan, catalog);
  return (
    <View style={{ paddingTop: space.xxl }}>
      <EmptyState
        title="Purchase complete"
        detail={`Your ${label ?? "new"} plan is being activated. This usually takes a few seconds — you can close this screen, it will finish on its own.`}
      />
      <View style={{ alignItems: "center", gap: space.sm }}>
        <ActivityIndicator color={colors.textMuted} />
        <Text style={{ ...type.caption, color: colors.textMuted }}>
          Activating…
        </Text>
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
    <View style={{ paddingTop: space.xxl }}>
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
 * cards below cannot be tapped, and an unexplained dead control is what #115
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
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.lg }}>
      <View
        style={{
          backgroundColor: colors.accentSoft,
          borderRadius: 12,
          padding: space.lg,
          gap: space.xs,
        }}
      >
        <Text
          style={{ ...type.callout, color: colors.text, fontWeight: "600" }}
        >
          {stripe
            ? "You're subscribed through omg.dev on the web"
            : "Purchases are unavailable"}
        </Text>
        <Text
          style={{
            ...type.footnote,
            color: colors.textSecondary,
            lineHeight: 18,
          }}
        >
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
