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

import { ActivityIndicator, Linking, ScrollView, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState, PrimaryButton, SectionLabel } from "../src/components";
import { PressableScale } from "../src/omg/motion";
import { Text } from "../src/omg/text";
import { useTheme } from "../src/omg/theme";
import { TierCard } from "../src/omg/tier-card";
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
  const currentPlan = phase.kind === "done" ? phase.entitlement.plan : account?.plan ?? null;
  /**
   * The tier list to NAME plans from. Not the same thing as `products`, which
   * is only what Apple will sell right now: a plan the account is already on
   * can be absent from the store (retired, or pulled from App Store Connect)
   * and still needs a name in "You're all set" and in the Stripe notice.
   */
  const catalog = account?.tiers ?? FALLBACK_TIERS;

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
        <Subscribed entitlement={phase.entitlement} catalog={catalog} />
      ) : phase.kind === "activating" ? (
        <Activating plan={phase.plan} catalog={catalog} />
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
            Your cloud computer runs on an auto-renewable monthly subscription. Pick the
            size you need — you can change or cancel it any time in the App Store.
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
            <AlreadySubscribed plan={account.plan} reason={account.reason} catalog={catalog} />
          ) : null}

          {products.length > 0 ? (
            <>
              <SectionLabel>Monthly subscriptions</SectionLabel>
              {products.map((product) => (
                <TierCard
                  key={product.productId}
                  product={product}
                  current={currentPlan === product.plan}
                  purchasing={phase.kind === "purchasing" && phase.productId === product.productId}
                  disabled={busy || !account?.canPurchase || currentPlan === product.plan}
                  onPress={() => void buy(product)}
                />
              ))}
              {/* ── REMOVED: an idle-billing claim that is not currently true ──
                  This said, directly above a Buy button:

                    "Every plan pauses while idle, so time you are not using
                     does not come out of your hours. A paused Computer keeps
                     its files and picks up where it left off."

                  Session d3f4e3e8 measured a cloud Computer with no sessions
                  and nothing connected, twice, five minutes each:

                    2083 micros / 302s -> 24,830 micros/hour

                  Full running rate is 25,000 and hibernated is 0, so an idle
                  Computer bills at 99.3% of full rate. The second measurement
                  was taken AFTER an explicit pause through the lifecycle
                  endpoint and was identical to the byte. Idle time comes out
                  of your hours almost entirely.

                  That makes this the most consequential sentence on the
                  screen, because it is what tells someone how to read every
                  "N hours" above it — 20 hours of USAGE and 20 hours of
                  CALENDAR are different products at the same price. Stating it
                  wrongly next to a purchase is worse than not explaining the
                  hours at all, which is the same rule this file already
                  follows for spec numbers: degrade to silence, never to a
                  number we cannot stand behind.

                  RESTORE THIS, unchanged, once idle Computers actually stop
                  billing — the sentence is good and it is where it belongs.
                  Do not reword it to describe the current behaviour instead:
                  "your hours are consumed whether or not you are working" is
                  accurate today, but it is a platform decision in flight
                  (raised with Benny, outside this release), and a paywall is
                  the wrong place to litigate it. Silence is honest in both
                  states. */}
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
            <LegalLinks />
          </View>
        </>
      )}
    </ScrollView>
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
 * One fact about a tier: an icon, what it is, and the number.
 *
 * Every row is exactly one line by construction. The value never wraps and
 * never shrinks; the label yields first, because a wrapped value would make one
 * card taller than its neighbours and break the column of numbers that makes
 * five tiers comparable at a glance.
 */
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
    <View style={{ paddingTop: space.xxl }}>
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
