/**
 * THE FINDINGS PILL, AND THE DRAWER BEHIND IT.
 *
 * Open findings used to be a fourth section under Idle, one 80pt row per
 * agent. Three findings pushed the sessions that are actually running off
 * the fold, and the section read as more work in a list that is already
 * about work. Benny asked for a small pill instead, at the bottom of the
 * list, that opens a drawer.
 *
 * THE PILL floats above the composer on the phone (above the rail's footer
 * on iPad), centred, with a quiet count labelled Updates. Severity stays in the
 * drawer rows so the badge does not compete with active sessions. It draws nothing
 * when there is nothing open, the same rule the section followed.
 *
 * ON THE IPAD RAIL the pill opens its list IN the rail, under the sessions,
 * not in the sheet (FindingsRailPanel below). Same change as the web's
 * desktop rail: a bottom sheet is a phone shape, and on a wide screen it
 * pulled the eye away from the rail the pill lives in.
 *
 * THE DRAWER is the app's one card (Sheet) with the same rows the section
 * showed (AutoReportRow), so a finding looks the same here as it did in the
 * list and tapping it still opens the agent's report. The rows do not
 * animate in: the sheet's own slide is the entrance.
 */
import { Pressable, ScrollView as PlainScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Reanimated, { FadeIn, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { Icon, withAlpha } from "../components";
import { AutoReportRow } from "./auto-agent-card";
import type { AutoFindingGroup } from "./auto-agents";
import { GlassSurface } from "./glass";
import { PressableScale } from "./motion";
import { Sheet } from "./sheet";
import { SheetScrollView as ScrollView } from "./sheet-scroll";
import { Text } from "./text";
import { useTheme } from "./theme";

/**
 * The pill's own height, and the gap it keeps above the composer.
 *
 * Exported because the phone's list has to reserve this space too. The pill
 * floats OVER the list, so a list that only clears the composer leaves its
 * last card permanently under the pill, with no way to scroll it out. The
 * clearance and the placement must come from one number or they drift apart.
 */
export const PILL_HEIGHT = 28;
export const PILL_GAP = 8;

export function findingsCount(groups: ReadonlyArray<AutoFindingGroup>): number {
  return groups.reduce((n, group) => n + group.rows.length, 0);
}

export function FindingsPill({
  groups,
  onPress,
}: {
  groups: ReadonlyArray<AutoFindingGroup>;
  onPress: () => void;
}) {
  const { colors, radius, type, space } = useTheme();
  const count = findingsCount(groups);
  if (!count) return null;
  const label = `${count} update${count === 1 ? "" : "s"}`;
  return (
    <PressableScale
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      scale={0.96}
      accessibilityRole="button"
      accessibilityLabel={`${label} from auto agents. Open`}
      hitSlop={8}
      style={{ alignSelf: "center" }}
    >
      <GlassSurface
        variant="regular"
        fallbackColor={colors.card}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          paddingHorizontal: space.sm,
          height: PILL_HEIGHT,
          borderRadius: radius.pill,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.borderSoft,
          overflow: "hidden",
        }}
      >
        <Text
          style={{
            ...type.caption,
            fontWeight: "500",
            fontVariant: ["tabular-nums"],
            color: colors.textSecondary,
          }}
        >
          {label}
        </Text>
        <Icon ios="chevron.up" android="keyboard_arrow_up" size={10} color={colors.textMuted} />
      </GlassSurface>
    </PressableScale>
  );
}

export function FindingsDrawer({
  visible,
  onClose,
  groups,
  onOpenAgent,
}: {
  visible: boolean;
  onClose: () => void;
  groups: ReadonlyArray<AutoFindingGroup>;
  /** Tap on a row. The drawer closes itself first. */
  onOpenAgent: (agentId: string) => void;
}) {
  const { colors, type, space } = useTheme();
  const { height } = useWindowDimensions();
  const count = findingsCount(groups);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingBottom: space.sm,
        }}
      >
        <Text style={{ ...type.headline, color: colors.text }}>Updates</Text>
        <Text style={{ ...type.subhead, color: colors.textMuted, fontVariant: ["tabular-nums"] }}>
          {count} open
        </Text>
      </View>
      <ScrollView
        style={{ maxHeight: Math.round(height * 0.55) }}
        contentContainerStyle={{ paddingHorizontal: space.xs, paddingBottom: space.md, gap: space.xs }}
        showsVerticalScrollIndicator={false}
      >
        {count ? (
          groups.map((group) => (
            <View
              key={group.agentId}
              style={{ borderRadius: 10, backgroundColor: withAlpha(colors.text, 0.04) }}
            >
              <AutoReportRow
                group={group}
                animateEntry={false}
                onOpen={() => {
                  void Haptics.selectionAsync();
                  onClose();
                  onOpenAgent(group.agentId);
                }}
              />
            </View>
          ))
        ) : (
          <Text
            style={{
              ...type.footnote,
              color: colors.textMuted,
              textAlign: "center",
              paddingVertical: space.lg,
            }}
          >
            No updates.
          </Text>
        )}
      </ScrollView>
    </Sheet>
  );
}

/**
 * The Updates list, inline at the foot of the iPad rail.
 *
 * Takes at most half the rail, so the sessions above it stay on screen. It
 * slides up as it opens, and the header folds it back into the pill. Rows are
 * the drawer's rows, so a finding reads the same in both places.
 */
export function FindingsRailPanel({
  groups,
  onHide,
  onOpenAgent,
  maxHeight,
}: {
  groups: ReadonlyArray<AutoFindingGroup>;
  onHide: () => void;
  onOpenAgent: (agentId: string) => void;
  maxHeight: number;
}) {
  const { colors, type, space } = useTheme();
  const count = findingsCount(groups);
  if (!count) return null;
  return (
    <Reanimated.View
      entering={FadeInUp.duration(260)}
      accessibilityLabel="Updates"
      style={{
        maxHeight,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
      }}
    >
      <Pressable
        onPress={onHide}
        accessibilityRole="button"
        accessibilityLabel="Hide updates"
        accessibilityState={{ expanded: true }}
        hitSlop={4}
        style={{
          height: 40,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: space.md,
        }}
      >
        <Text style={{ ...type.subhead, fontWeight: "600", color: colors.text }}>Updates</Text>
        <Text
          style={{ ...type.footnote, flex: 1, color: colors.textMuted, fontVariant: ["tabular-nums"] }}
        >
          {count} open
        </Text>
        <Icon ios="chevron.down" android="keyboard_arrow_down" size={12} color={colors.textMuted} />
      </Pressable>
      <PlainScrollView
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: space.xs, paddingBottom: space.sm, gap: space.xs }}
        showsVerticalScrollIndicator={false}
      >
        {groups.map((group) => (
          <View key={group.agentId} style={{ borderRadius: 10, backgroundColor: withAlpha(colors.text, 0.04) }}>
            <AutoReportRow
              group={group}
              animateEntry={false}
              onOpen={() => {
                void Haptics.selectionAsync();
                onOpenAgent(group.agentId);
              }}
            />
          </View>
        ))}
      </PlainScrollView>
    </Reanimated.View>
  );
}

/** The pill fading back in when the rail's list folds away. */
export const PILL_RETURN = FadeIn.duration(200);
