/**
 * Step 06: choose your plan. The last screen, and a skippable one.
 *
 * ── Both exits keep the work ──────────────────────────────────────────────
 *
 * Benny's board is explicit: subscribe, or "Continue for now", and either way
 * the current task and its result survive into the chat. Skipping spends the
 * remaining free allowance. A paywall that discarded the thing somebody just
 * wrote would undo the entire point of asking before sign-in.
 *
 * ── The products are the store's, and the buying is not this file's ───────
 *
 * Prices come from StoreKit, because a price written into a bundle is wrong in
 * every other currency and stale the day it changes.
 *
 * The purchase itself belongs to usePurchaseFlow(), the same hook app/plan.tsx
 * uses. There must be exactly one implementation of taking money: its rules
 * (a cancel is not an error, a failed submit is a slow activation and never a
 * failed payment) are each the result of a specific failure, and a second copy
 * would drift silently because a purchase cannot be exercised in CI or on a
 * simulator.
 *
 * Annual is NOT offered yet. The design marks its artboard price-pending and
 * the board says annual pricing and credit allowances need confirming, so the
 * toggle is absent rather than present and lying.
 *
 * Design: artboard "06 · Choose your plan · Full screen".
 */
import { useEffect } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../components";
import { SecondaryAction } from "./onboarding-chrome";
import { usePurchaseFlow } from "./purchase-flow";
import { Text } from "./text";
import { TierCard } from "./tier-card";
import { useTheme } from "./theme";

export function PlanScreen({
  onPurchased,
  onSkip,
  onClose,
}: {
  /** A purchase completed, or an existing one was restored. */
  onPurchased: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const { colors, space, type } = useTheme();
  const insets = useSafeAreaInsets();
  const { phase, products, busy, buy, restore } = usePurchaseFlow();

  /*
   * A finished purchase leaves the flow rather than showing a receipt screen.
   * app/plan.tsx has one because it is reached FROM a blocked computer and the
   * outcome is the whole point of the visit; here the outcome is the session
   * waiting behind this screen, so the right celebration is getting out of the
   * way. `activating` counts: Apple has the money and the entitlement is
   * coming, and holding somebody on a paywall to wait for a webhook is the
   * worst reading of that state.
   */
  useEffect(() => {
    if (phase.kind === "done" || phase.kind === "activating") onPurchased();
  }, [phase.kind, onPurchased]);

  /*
   * `unavailable` is a simulator or a build with no StoreKit. It is an empty
   * list here, not an error panel: "Continue for now" is the outcome that
   * matters and this screen must never trap anyone.
   */
  const loading = phase.kind === "loading";

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: space.lg + 4,
          height: 52,
        }}
      >
        <Pressable accessibilityRole="button" onPress={() => void restore()} hitSlop={12} disabled={busy}>
          <Text style={{ ...type.subhead, color: colors.textMuted }}>Restore purchases</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={12}
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.card,
          }}
        >
          <Icon ios="xmark" android="close" size={13} color={colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg + 4, paddingBottom: space.xl, gap: space.lg }}
      >
        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.largeTitle, color: colors.text }}>Keep work moving.</Text>
          <Text style={{ ...type.body, color: colors.textMuted }}>A workspace that grows with you.</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.textMuted} style={{ marginTop: space.xl }} />
        ) : products.length === 0 ? (
          /*
           * Nothing to sell: a simulator, a build with no StoreKit, or a store
           * that is briefly unreachable. Say so in one line. A blank slab above
           * "Continue for now" reads as a screen that failed to load, and this
           * is the last thing between somebody and the session they just
           * started.
           */
          <Text style={{ ...type.body, color: colors.textMuted }}>
            Plans are not available on this device right now. Everything below still works.
          </Text>
        ) : (
          products.map((product) => (
            <TierCard
              key={product.productId}
              product={product}
              current={false}
              purchasing={phase.kind === "purchasing" && phase.productId === product.productId}
              disabled={busy}
              onPress={() => void buy(product)}
            />
          ))
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: space.lg + 4, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
        {/*
         * Always reachable, and never a disabled state. The task and its
         * result survive this either way, so nothing here is a gate.
         */}
        <SecondaryAction label="Continue for now" onPress={onSkip} />
      </View>
    </View>
  );
}
