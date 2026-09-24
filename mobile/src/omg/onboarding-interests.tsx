/**
 * Step 02: what would you like help with?
 *
 * One answer, four lanes, and it is the pivot the rest of the flow turns on:
 * step 03's tasks and tool badges, step 03's prefilled prompt, and step 05's
 * headline word all come from it. The lanes and their contents live in
 * onboarding-tasks.ts so this file holds no copy of its own.
 *
 * SINGLE SELECT, and Continue is disabled until something is chosen. A default
 * selection would be a guess wearing the person's answer, and every screen
 * after this treats the answer as theirs.
 *
 * Design: "v2_omg.dev iOS onboarding", artboard "02 · Your interests [03]".
 */
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { Icon } from "../components";
import type { ComponentProps } from "react";
import { INTEREST_LANES, type InterestKey } from "./onboarding-tasks";
import { PrimaryAction, StepHeader, StepHeading } from "./onboarding-chrome";
import { Text } from "./text";
import { useTheme } from "./theme";

/**
 * The glyph per lane. Decoration, matching the design.
 *
 * Typed off `Icon`'s own props rather than `string`: the symbol names are a
 * closed set on both platforms, and a typo in one would otherwise render
 * nothing at all with no error anywhere.
 */
type Glyph = Extract<ComponentProps<typeof Icon>, { ios: unknown }>;
const GLYPH: Record<InterestKey, Glyph> = {
  build: { ios: "globe", android: "language" },
  design: { ios: "square.3.layers.3d", android: "layers" },
  data: { ios: "chart.bar", android: "bar_chart" },
  code: { ios: "chevron.left.forwardslash.chevron.right", android: "code" },
  sales: { ios: "chart.line.uptrend.xyaxis", android: "trending_up" },
};

export function InterestsScreen({
  chosen,
  onChoose,
  onContinue,
  onBack,
}: {
  chosen: InterestKey | null;
  onChoose: (key: InterestKey) => void;
  onContinue: () => void;
  /** Absent on first run: Welcome was before sign-in, so there is no back. */
  onBack?: () => void;
}) {
  const { colors, space, type } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <StepHeader onBack={onBack} />
      <View style={{ flex: 1, paddingHorizontal: space.lg + 4, gap: space.xl }}>
        {/*
         * The design reads "What you working daily?", which is missing a verb.
         * Shipped, it reads as a typo on the second screen anybody ever sees,
         * so the sense is kept and the grammar fixed. No hard line break: one
         * sentence, and a forced break strands a word on a narrow phone.
         */}
        <StepHeading title="What do you work on daily?" />

        <View>
          {INTEREST_LANES.map((lane, index) => {
            const selected = lane.key === chosen;
            return (
              <Pressable
                key={lane.key}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={lane.label}
                onPress={() => {
                  void Haptics.selectionAsync();
                  onChoose(lane.key);
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  paddingVertical: 18,
                  // A hairline between rows, not around them: the design lists
                  // these, it does not card them.
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                {/* Fixed slot so the labels share one lane whatever the glyph. */}
                <View style={{ width: 28, alignItems: "center", flexShrink: 0 }}>
                  <Icon {...GLYPH[lane.key]} size={20} color={colors.text} />
                </View>
                <Text style={{ ...type.headline, color: colors.text, flex: 1 }}>{lane.label}</Text>
                <Selected on={selected} />
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ paddingHorizontal: space.lg + 4, paddingBottom: insets.bottom + space.lg }}>
        <PrimaryAction label="Continue" onPress={onContinue} disabled={!chosen} />
      </View>
    </View>
  );
}

/**
 * Filled check when chosen, empty ring when not.
 *
 * The ring is drawn either way so the rows keep one trailing lane -- dropping
 * it on the unselected rows would shift every label by the width of a circle
 * the moment somebody picks one.
 */
function Selected({ on }: { on: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 24,
        height: 24,
        borderRadius: 12,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? colors.text : "transparent",
        borderWidth: on ? 0 : 1.5,
        borderColor: colors.border,
      }}
    >
      {on ? <Icon ios="checkmark" android="check" size={12} color={colors.bg} /> : null}
    </View>
  );
}
