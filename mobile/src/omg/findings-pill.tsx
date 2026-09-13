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
 * THE DRAWER is the app's one card (Sheet) with the same rows the section
 * showed (AutoReportRow), so a finding looks the same here as it did in the
 * list and tapping it still opens the agent's report. The rows do not
 * animate in: the sheet's own slide is the entrance.
 */
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import * as Haptics from "expo-haptics";

import { Icon, withAlpha } from "../components";
import { AutoReportRow } from "./auto-agent-card";
import type { AutoFindingGroup } from "./auto-agents";
import { GlassSurface } from "./glass";
import { PressableScale } from "./motion";
import { Sheet } from "./sheet";
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
