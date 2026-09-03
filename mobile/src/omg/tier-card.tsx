/**
 * One subscription tier as a card: name, Apple's price, and the specs the
 * server handed us. Shared by the paywall (app/plan.tsx) and the plan step of
 * onboarding, so both show a tier in the same shape. The card is presentation
 * only; whoever renders it decides what a tap does.
 */

import { ActivityIndicator, View } from "react-native";

import { Icon, Separator } from "../components";
import { PressableScale } from "./motion";
import {
  formatComputeHours,
  formatMachine,
  formatParallelAgents,
  sleepsBetweenTasks,
  type TierSpecs,
} from "./plan-specs";
import type { StoreProduct } from "./store";
import { Text } from "./text";
import { useTheme } from "./theme";

function SpecRow({
  label,
  value,
  emphasis = false,
  ...glyph
}: {
  label: string;
  value: string;
  /** The number this tier is really sold on. */
  emphasis?: boolean;
} & ({ ios: "clock"; android: "schedule" } | { ios: "cpu"; android: "memory" } | { ios: "internaldrive"; android: "storage" } | { ios: "bolt.fill"; android: "bolt" })) {
  const { colors, type, space } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 5 }}>
      <Icon
        {...glyph}
        size={15}
        weight={emphasis ? "semibold" : "regular"}
        color={emphasis ? colors.text : colors.textMuted}
      />
      <Text numberOfLines={1} style={{ ...type.footnote, color: colors.textMuted, flexShrink: 1 }}>
        {label}
      </Text>
      <Text
        style={{
          ...type.footnote,
          color: colors.text,
          fontWeight: emphasis ? "600" : "500",
          marginLeft: "auto",
          flexShrink: 0,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

/**
 * One tier, as something you can read rather than only price-compare.
 *
 * ── Why a list of cards and not the dashboard's slider ──────────────────────
 *
 * The dashboard shows ONE rung at a time and makes moving between them the
 * whole interaction: a slider, ticks, a spring onto each detent. That works
 * because a mouse is bad at direct selection and good at scrubbing, and because
 * the overlay owns the entire viewport.
 *
 * Neither holds here. The equivalent of "move between the rungs" that a thumb
 * already does perfectly is SCROLL — the vertical scroll IS this screen's
 * slider, and it costs nothing to learn. Reproducing a drag control would also
 * have meant five tiers hidden behind a gesture nobody was told about, on the
 * one screen where hiding what someone is buying is the actual complaint.
 *
 * So: same vocabulary as the web ("Compute time", "Machine", "Disk", "agents in
 * parallel", the same formatters), same facts, different control. All five are
 * visible and comparable without touching anything, which a slider cannot do.
 *
 * ── The card makes no claim it was not handed ──────────────────────────────
 *
 * `specs` is null whenever the server did not describe this tier, and then the
 * card is deliberately just a name and Apple's price. That is the honest
 * degradation and it is the reason the numbers left the bundle: a stale spec
 * would still render beautifully.
 */
export function TierCard({
  product,
  current,
  purchasing,
  disabled,
  onPress,
}: {
  product: StoreProduct;
  current: boolean;
  purchasing: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors, radius, type, space } = useTheme();
  const specs: TierSpecs | null = product.specs;
  const sleeps = specs ? sleepsBetweenTasks(specs) : null;

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      // One label for the whole card. VoiceOver reading eight separate nodes
      // per tier, five times over, is how a screen becomes unusable while
      // technically being accessible.
      accessibilityLabel={[
        product.label,
        current ? "current plan" : product.displayPrice + " per month",
        specs
          ? `${formatParallelAgents(specs.parallelAgents)}, ${formatComputeHours(specs.computeHours)} of compute time, ${formatMachine(specs)}, ${specs.diskGb} GB disk${sleeps ? ", always on, never sleeps" : ""}`
          : "",
      ]
        .filter(Boolean)
        .join(". ")}
      scale={0.98}
      style={({ pressed }) => ({
        backgroundColor: pressed && !disabled ? colors.cardPressed : colors.card,
        borderRadius: radius.lg,
        marginHorizontal: space.lg,
        marginBottom: space.md,
        padding: space.lg,
        gap: specs ? space.md : 0,
        // The current plan is outlined rather than dimmed. Dimming it would
        // hide the specs of the machine someone actually has, which is the one
        // tier they have the most reason to re-read.
        borderWidth: current ? 1.5 : 0,
        borderColor: current ? colors.primary : "transparent",
        // Only a card you cannot buy fades, and the current plan is not one of
        // those — it is disabled because it is already yours.
        opacity: disabled && !current ? 0.5 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ ...type.headline, color: colors.text }}>{product.label}</Text>
          {specs ? (
            /* The dashboard's hero number, demoted to a subtitle. It is still
               the headline fact — the thing the ladder is really sold on — but
               five 40pt numbers down a scroll is five heroes and therefore
               none. */
            <Text style={{ ...type.subhead, color: colors.textSecondary }}>
              {formatParallelAgents(specs.parallelAgents)}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 1 }}>
          {purchasing ? (
            <ActivityIndicator color={colors.textMuted} />
          ) : (
            <>
              {/* Apple's string, verbatim. Never composed here — it is a
                  different currency in every storefront. */}
              <Text style={{ ...type.headline, color: colors.text }}>{product.displayPrice}</Text>
              {current ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Icon ios="checkmark" android="check" size={11} weight="semibold" color={colors.primary} />
                  <Text style={{ ...type.caption, color: colors.primary }}>Current plan</Text>
                </View>
              ) : (
                <Text style={{ ...type.caption, color: colors.textMuted }}>per month</Text>
              )}
            </>
          )}
        </View>
      </View>

      {specs ? (
        <>
          <Separator />
          <View>
            {/* Compute time carries the emphasis, matching the dashboard: it is
                the allowance that actually runs out, and the one people are
                surprised by. */}
            <SpecRow
              ios="clock"
              android="schedule"
              label="Compute time"
              value={formatComputeHours(specs.computeHours)}
              emphasis
            />
            <SpecRow ios="cpu" android="memory" label="Machine" value={formatMachine(specs)} />
            <SpecRow
              ios="internaldrive"
              android="storage"
              label="Disk"
              value={`${specs.diskGb} GB`}
            />
            {sleeps ? (
              <SpecRow
                ios="bolt.fill"
                android="bolt"
                label="Sleeps between tasks"
                value={sleeps}
                emphasis
              />
            ) : null}
          </View>
        </>
      ) : null}
    </PressableScale>
  );
}
