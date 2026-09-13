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
 * on iPad), centred, and says exactly two things: how many findings are
 * open, and how bad the worst of them are. The severity dots are the same
 * colours the rows use (SeverityDot), one per agent with something to say,
 * worst first, capped at three so the pill stays a pill. It draws nothing
 * when there is nothing open, the same rule the section followed.
 *
 * THE DRAWER is the app's one card (Sheet) with the same rows the section
 * showed (AutoReportRow), so a finding looks the same here as it did in the
 * list and tapping it still opens the agent's report. The rows do not
 * animate in: the sheet's own slide is the entrance.
 */
import { ScrollView, useWindowDimensions, View } from "react-native";
import * as Haptics from "expo-haptics";

import { Icon, withAlpha } from "../components";
import { AutoReportRow, SeverityDot, worstSeverity } from "./auto-agent-card";
import type { AutoFindingGroup, AutoFindingSeverity } from "./auto-agents";
import { GlassSurface } from "./glass";
import { PressableScale } from "./motion";
import { Sheet } from "./sheet";
import { Text } from "./text";
import { useTheme } from "./theme";

const SEVERITY_ORDER: Record<AutoFindingSeverity, number> = { high: 0, med: 1, low: 2 };

/**
 * The pill's own height, and the gap it keeps above the composer.
 *
 * Exported because the phone's list has to reserve this space too. The pill
 * floats OVER the list, so a list that only clears the composer leaves its
 * last card permanently under the pill, with no way to scroll it out. The
 * clearance and the placement must come from one number or they drift apart.
 */
export const PILL_HEIGHT = 34;
export const PILL_GAP = 8;

/** One dot per agent with open findings, worst first, at most three. */
export function pillSeverities(groups: ReadonlyArray<AutoFindingGroup>): AutoFindingSeverity[] {
  return groups
    .map((group) => worstSeverity(group.rows.map((row) => row.finding)) ?? "low")
    .sort((a, b) => SEVERITY_ORDER[a] - SEVERITY_ORDER[b])
    .slice(0, 3);
}

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
  const label = `${count} finding${count === 1 ? "" : "s"}`;
  return (
    <PressableScale
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      scale={0.96}
      accessibilityRole="button"
      accessibilityLabel={`${label} from auto agents. Open`}
      style={{ alignSelf: "center" }}
    >
      <GlassSurface
        variant="regular"
        fallbackColor={colors.card}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingLeft: space.md,
          paddingRight: space.md - 2,
          height: PILL_HEIGHT,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          {pillSeverities(groups).map((severity, i) => (
            <SeverityDot key={i} severity={severity} />
          ))}
        </View>
        <Text
          style={{
            ...type.footnote,
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
            color: colors.text,
          }}
        >
          {label}
        </Text>
        <Icon ios="chevron.up" android="keyboard_arrow_up" size={12} color={colors.textMuted} />
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
        <Text style={{ ...type.headline, color: colors.text }}>Auto</Text>
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
            Nothing open.
          </Text>
        )}
      </ScrollView>
    </Sheet>
  );
}
