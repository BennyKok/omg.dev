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
 * ── The products are the store's, never this file's ───────────────────────
 *
 * Prices come from StoreKit through fetchTiers(), because a price written into
 * a bundle is wrong in every other currency and stale the day it changes.
 * FALLBACK_TIERS is the catalogue to ask for, not a price list to display.
 *
 * Annual is NOT offered yet. The design marks its artboard price-pending and
 * the board says annual pricing and credit allowances need confirming, so the
 * toggle is absent rather than present and lying.
 *
 * Design: artboard "06 · Choose your plan · Full screen".
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../components";
import { FALLBACK_TIERS } from "./plan-specs";
import { SecondaryAction } from "./onboarding-chrome";
import { connectStore, fetchTiers, isStoreAvailable, type StoreProduct } from "./store";
import { Text } from "./text";
import { TierCard } from "./tier-card";
import { useTheme } from "./theme";

export function PlanScreen({
  onPurchase,
  onSkip,
  onRestore,
  onClose,
}: {
  onPurchase: (product: StoreProduct) => void;
  onSkip: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const { colors, space, type } = useTheme();
  const insets = useSafeAreaInsets();
  const [products, setProducts] = useState<StoreProduct[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!isStoreAvailable()) {
      // A simulator, or a build with no StoreKit. Show the skip rather than a
      // spinner that will never resolve -- this screen must never trap anyone.
      setProducts([]);
      return;
    }
    void (async () => {
      try {
        await connectStore();
        const loaded = await fetchTiers(FALLBACK_TIERS);
        if (!cancelled) setProducts(loaded);
      } catch {
        // The store is unreachable. "Continue for now" still works, which is
        // the outcome that matters.
        if (!cancelled) setProducts([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
        <Pressable accessibilityRole="button" onPress={onRestore} hitSlop={12}>
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

        {products === null ? (
          <ActivityIndicator color={colors.textMuted} style={{ marginTop: space.xl }} />
        ) : (
          products.map((product) => (
            <TierCard
              key={product.productId}
              product={product}
              current={false}
              purchasing={false}
              disabled={false}
              onPress={() => onPurchase(product)}
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
