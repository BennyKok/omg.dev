/**
 * The pieces every onboarding step shares: the primary button, the back
 * chevron, and the heading block.
 *
 * They live together because the flow's rhythm IS the repetition -- the same
 * button in the same place on seven screens is what makes it feel like one
 * thing rather than seven. Re-implementing the button per screen is how the
 * radius drifts on step 04 and nobody notices for a month.
 *
 * Design: "v2_omg.dev iOS onboarding", page "Version 2 · Clean onboarding".
 */
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";

import { Icon } from "../components";
import { Text } from "./text";
import { useTheme } from "./theme";

/**
 * The one black button at the foot of every step.
 *
 * Full width, 56 tall, pill-cornered, always on screen. The panels this flow
 * replaces had the same rule and it is the one worth keeping: there is exactly
 * one way forward and it is never hidden behind a gesture.
 */
export function PrimaryAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors, radius, type } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => ({
        height: 56,
        borderRadius: radius.xl,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.text,
        opacity: disabled ? 0.35 : pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ ...type.headline, color: colors.bg }}>{label}</Text>
    </Pressable>
  );
}

/** A quieter second action under the primary one, for "Not now" and "Skip". */
export function SecondaryAction({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors, type } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => ({ alignItems: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={{ ...type.headline, color: colors.text }}>{label}</Text>
    </Pressable>
  );
}

/**
 * The top row: a back chevron, and optionally a word in the corner.
 *
 * `trailing` carried the chosen lane on step 03 so the branch was never a
 * mystery. Benny dropped it from the design, so nothing passes it today. The
 * prop stays because the header is shared and a corner word is an ordinary
 * thing for it to offer -- but do not restore the lane label here without
 * checking the design first.
 */
export function StepHeader({ onBack, trailing }: { onBack?: () => void; trailing?: string }) {
  const { colors, space, type } = useTheme();
  return (
    <View
      style={{
        height: 52,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: space.xs,
      }}
    >
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={12}
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Icon ios="chevron.left" android="arrow_back" size={18} color={colors.text} />
        </Pressable>
      ) : (
        <View style={{ width: 44 }} />
      )}
      {trailing ? (
        <Text style={{ ...type.subhead, color: colors.textMuted }}>{trailing}</Text>
      ) : null}
    </View>
  );
}

/** Large title plus optional supporting line, the same on every step. */
export function StepHeading({ title, body }: { title: string; body?: string }) {
  const { colors, space, type } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ ...type.largeTitle, color: colors.text }}>{title}</Text>
      {body ? <Text style={{ ...type.body, color: colors.textMuted }}>{body}</Text> : null}
    </View>
  );
}

/** A step's body, so every screen shares one gutter and one bottom inset. */
export function StepShell({
  header,
  children,
  actions,
}: {
  header?: ReactNode;
  children: ReactNode;
  actions: ReactNode;
}) {
  const { colors, space } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {header}
      <View style={{ flex: 1, paddingHorizontal: space.lg + 4, gap: space.xl }}>{children}</View>
      <View style={{ paddingHorizontal: space.lg + 4, gap: space.md }}>{actions}</View>
    </View>
  );
}
