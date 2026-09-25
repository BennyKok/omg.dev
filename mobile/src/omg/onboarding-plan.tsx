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
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "../components";
import { PrimaryAction, SecondaryAction } from "./onboarding-chrome";
import { usePurchaseFlow } from "./purchase-flow";
import { agentIcon } from "./agent-icons";
import type { StoreProduct } from "./store";
import { Text } from "./text";
import { useTheme } from "./theme";

/**
 * The board names the tiers "Starter" and "Personal". The App Store product
 * for the first is called "Starter Plus", and that name is what Apple prints
 * on its own purchase sheet, so it stays on the product. The screen shows the
 * board's word, keyed by plan and never by string surgery on the label.
 */
const DISPLAY_LABELS: Record<string, string> = {
  computer_s40: "Starter",
  computer_5: "Personal",
};

function displayLabel(product: StoreProduct): string {
  return DISPLAY_LABELS[product.plan] ?? product.label;
}

/**
 * Fixed copy, by column, from the board. Benny chose words over numbers here:
 * "Everyday" says more to a first-time buyer than a vCPU count, and the specs
 * still reach the accessibility label so nothing is hidden from a reader.
 */
const WORKSPACE_COPY = ["Everyday", "Bigger &\nfaster"];
/** The board's numbers, used when the store product carries no specs (the simulator's mock catalog). */
const AGENTS_COPY = ["3", "5"];

type Row = { label: string; values: string[]; muted?: boolean };

export function PlanScreen({
  onPurchased,
  onSkip,
  onClose,
}: {
  onPurchased: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const { colors, space, type } = useTheme();
  const insets = useSafeAreaInsets();
  const { phase, products, busy, buy, restore } = usePurchaseFlow();
  /*
   * Personal is preselected. Benny's call: the column the CTA reads is the
   * one to steer towards. Index 1 is Personal in the catalog order (Starter,
   * Personal); with a single product on offer the index clamps to it.
   */
  const [selected, setSelected] = useState(1);

  /*
   * Done means paid (or restored): leave. `activating` is the backend still
   * catching up on a purchase Apple already confirmed, and the app treats it
   * the same way rather than making a paying customer wait on a spinner.
   */
  useEffect(() => {
    if (phase.kind === "done" || phase.kind === "activating") onPurchased();
  }, [phase.kind, onPurchased]);

  /*
   * "unavailable" is a real state (no StoreKit on a simulator, a storefront
   * with no products), not an error. The screen still offers the way out.
   */
  const loading = phase.kind === "loading";
  const columns = products.slice(0, 2);
  const selectedIndex = Math.min(selected, Math.max(0, columns.length - 1));
  const chosen = columns[selectedIndex];
  const rows: Row[] = [
    {
      label: "Agents at once",
      values: columns.map((p, i) => (p.specs ? String(p.specs.parallelAgents) : AGENTS_COPY[i] ?? "\u2014")),
    },
    { label: "Workspace", values: columns.map((_, i) => WORKSPACE_COPY[i] ?? "\u2014") },
    // Personal carries more credit than Starter. The amounts are not in the
    // catalog this app reads, so the row says the direction and not a number.
    { label: "AI credits", values: columns.map((_, i) => (i === 0 ? "Included" : "More included")) },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.card, paddingTop: insets.top }}>
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
          <Text style={{ ...type.footnote, color: colors.textMuted }}>Restore purchases</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={12}
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.bg,
          }}
        >
          <Icon ios="xmark" android="close" size={13} color={colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg + 4, paddingTop: space.md, paddingBottom: space.xl, gap: space.lg }}
        showsVerticalScrollIndicator={false}
      >
        {/*
         * The picnic illustration from App Store screenshot 4 (Benny,
         * 2026-09-24), cut from the rendered screenshot with its white
         * background removed, so it sits on either appearance. It sits in
         * the scroll view, so a short phone scrolls it away instead of
         * squeezing the plans or pushing the buttons off screen.
         */}
        <Image
          source={require("../../assets/onboarding/plan-picnic.png")}
          style={{ width: "100%", height: 96, marginBottom: -space.sm }}
          resizeMode="contain"
          accessible
          accessibilityLabel="Someone having a picnic while an agent works"
        />
        <View style={{ gap: space.sm }}>
          <Text style={{ ...type.largeTitle, fontSize: 32, color: colors.text }}>Keep work moving.</Text>
          <Text style={{ ...type.body, color: colors.textMuted }}>A workspace that grows with you.</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.textMuted} style={{ marginTop: space.xl }} />
        ) : columns.length === 0 ? (
          /*
           * No products: say so in the same voice as the rest of the screen.
           * "Continue for now" below is the outcome, not a fallback.
           */
          <Text style={{ ...type.body, color: colors.textMuted }}>
            Plans are not available on this device right now. Everything below still works.
          </Text>
        ) : (
          <>
            <View style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden" }}>
              {/* Header: the plan names, each a radio. */}
              <View style={{ flexDirection: "row", height: 60, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ width: 112 }} />
                {columns.map((product, i) => {
                  const on = i === selectedIndex;
                  return (
                    <Pressable
                      key={product.productId}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on, disabled: busy }}
                      accessibilityLabel={`${displayLabel(product)}, ${product.displayPrice} per month${product.specs ? `, ${product.specs.parallelAgents} agents at once` : ""}`}
                      disabled={busy}
                      onPress={() => setSelected(i)}
                      style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: on ? colors.bg : "transparent" }}
                    >
                      <View
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 9,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: on ? colors.text : "transparent",
                          borderWidth: on ? 0 : 1.5,
                          borderColor: colors.textMuted,
                        }}
                      >
                        {on ? <Icon ios="checkmark" android="check" size={10} color={colors.bg} /> : null}
                      </View>
                      <Text style={{ ...type.subhead, fontWeight: "600", color: colors.text }}>{displayLabel(product)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {rows.map((row) => (
                <View key={row.label} style={{ flexDirection: "row", minHeight: 44, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View style={{ width: 112, justifyContent: "center", paddingLeft: space.md, paddingVertical: space.sm }}>
                    <Text style={{ ...type.footnote, color: colors.text }}>{row.label}</Text>
                  </View>
                  {row.values.map((value, i) => (
                    <View
                      key={i}
                      style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: space.sm, backgroundColor: i === selectedIndex ? colors.bg : "transparent" }}
                    >
                      <Text style={{ ...type.subhead, fontWeight: i === selectedIndex ? "600" : "500", color: colors.text, textAlign: "center" }}>
                        {value}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
              <View style={{ flexDirection: "row", height: 76 }}>
                <View style={{ width: 112, justifyContent: "center", paddingLeft: space.md }}>
                  <Text style={{ ...type.footnote, color: colors.textMuted }}>{"Per month\nUSD"}</Text>
                </View>
                {columns.map((product, i) => (
                  <View
                    key={product.productId}
                    style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: i === selectedIndex ? colors.bg : "transparent" }}
                  >
                    <Text style={{ fontSize: 24, fontWeight: "700", letterSpacing: -0.5, color: colors.text }}>{product.displayPrice}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <Image source={agentIcon("codex-aisdk")} style={{ width: 24, height: 24, borderRadius: 6 }} />
                <Image source={agentIcon("aisdk")} style={{ width: 24, height: 24, borderRadius: 6 }} />
              </View>
              <Text style={{ ...type.subhead, fontWeight: "400", color: colors.textMuted }}>{"Bring your Claude Code\nor Codex subscription."}</Text>
            </View>
          </>
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: space.lg + 4, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
        {chosen ? (
          <>
            <PrimaryAction
              label={phase.kind === "purchasing" ? "Opening App Store\u2026" : `Continue with ${displayLabel(chosen)}`}
              onPress={() => void buy(chosen)}
              disabled={busy}
            />
            <Text style={{ ...type.footnote, color: colors.textMuted, textAlign: "center" }}>
              {"Renews monthly. Cancel anytime\nin App Store settings."}
            </Text>
          </>
        ) : null}
        {/*
         * Always reachable, and never a disabled state. The task and its
         * result are already in the chat; this is the way to them.
         */}
        <View style={{ height: 44, justifyContent: "center" }}>
          <SecondaryAction label="Continue for now" onPress={onSkip} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 18 }}>
          <Text onPress={() => void Linking.openURL("https://omg.dev/terms")} style={{ ...type.footnote, color: colors.textMuted }}>
            Terms
          </Text>
          <Text onPress={() => void Linking.openURL("https://omg.dev/privacy")} style={{ ...type.footnote, color: colors.textMuted }}>
            Privacy
          </Text>
        </View>
      </View>
    </View>
  );
}
