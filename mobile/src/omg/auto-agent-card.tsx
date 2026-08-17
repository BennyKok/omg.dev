/**
 * One open finding, as a home-screen row.
 *
 * WHY THIS IS NOT A SessionCard. The two look alike on purpose — same card
 * shape, same density — because they sit in the same list and a person
 * should not have to learn a second visual language halfway down the screen.
 * But the affordances differ: there is no transcript to push to, and nothing
 * to swipe away (yet — see the follow-up PR that adds dismiss and "start a
 * session from this").
 *
 * WHAT A ROW SAYS, AND WHY IT SAYS THAT.
 *
 * Matching the web's row (the "Auto" section's AutoFindingCard in
 * web/src/App.tsx) is the bar, so the vocabulary is lifted straight from it:
 * a severity dot, the agent's NAME, a relative time, and the finding's own
 * title underneath — nothing else. No schedule line, no "N open" chip, no
 * running indicator: those described the AGENT, and this row is about the
 * FINDING. One finding, one row, so there is nothing left to count.
 *
 * TAPPING OPENS IT IN PLACE. Nothing else on the phone lists findings, so a
 * row that shows a title and cannot show the reasoning behind it is a tease.
 * Expanding is all a read-only surface can honestly offer for now — acting on
 * a finding (dismiss, start a session) is a real mutation with a lifecycle
 * behind it (see FindingStatus in src/auto/store.ts) and lands separately.
 *
 * MOTION: `useListItemMotion()` and nothing else — no `exiting`, ever. See
 * the long note in motion.tsx. The expansion below is exactly the "a
 * re-render lands mid-animation" case that stranded views: it changes this
 * row's height while a 30s poll may be resizing its siblings, and it is safe
 * only because `entering` and `layout` both END with the view in its correct
 * flow position.
 */

import { View } from "react-native";
import Reanimated from "react-native-reanimated";

import { AgentAvatar } from "../components";
import { Text } from "./text";
import { useListItemMotion, PressableScale } from "./motion";
import { useTheme } from "./theme";
import { relativeTime } from "./format";
import type { AutoFindingRow, AutoFindingSeverity } from "./auto-agents";

function severityColor(
  severity: AutoFindingSeverity | undefined,
  colors: ReturnType<typeof useTheme>["colors"],
): string {
  switch (severity) {
    case "high":
      return colors.danger;
    case "med":
      return colors.warning;
    default:
      return colors.textMuted;
  }
}

/** The severity dot. 7pt: reads next to 13pt text without becoming a bullet. */
function SeverityDot({ severity }: { severity?: AutoFindingSeverity }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: severityColor(severity, colors),
      }}
    />
  );
}

export function AutoFindingCard({
  row,
  expanded,
  onToggle,
}: {
  row: AutoFindingRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { colors, radius, type, space } = useTheme();
  const listMotion = useListItemMotion();
  const { finding, agent } = row;
  const seen = finding.occurrences ?? 1;

  return (
    <Reanimated.View entering={listMotion.entering} layout={listMotion.layout}>
      <PressableScale
        onPress={onToggle}
        scale={0.98}
        accessibilityRole="button"
        accessibilityLabel={`${agent?.name ?? "Auto agent"} finding: ${finding.title}`}
        accessibilityState={{ expanded }}
        style={({ pressed }) => ({
          flexDirection: "row",
          gap: space.md,
          marginHorizontal: space.lg,
          padding: space.md,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          backgroundColor: pressed ? colors.cardPressed : colors.card,
        })}
      >
        <AgentAvatar agent={agent?.agent} size={26} plain busy={!!agent?.running} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text numberOfLines={1} style={{ ...type.headline, color: colors.text, flexShrink: 1 }}>
              {agent?.name ?? "Auto agent"}
            </Text>
            <Text style={{ ...type.caption, color: colors.textMuted, marginLeft: "auto" }}>
              {relativeTime(finding.lastSeenAt ?? finding.createdAt)}
            </Text>
          </View>

          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ marginTop: 5 }}>
              <SeverityDot severity={finding.severity} />
            </View>
            <Text
              numberOfLines={expanded ? undefined : 2}
              style={{ ...type.footnote, color: colors.textSecondary, flex: 1, lineHeight: 18 }}
            >
              {finding.title}
            </Text>
          </View>

          {expanded ? (
            <View style={{ gap: space.sm, paddingTop: space.xs }}>
              {seen > 1 ? (
                <Text style={{ ...type.caption, color: colors.warning }}>seen {seen}×</Text>
              ) : null}
              {finding.reasoning?.length ? (
                <View style={{ gap: 2 }}>
                  {finding.reasoning.map((line, i) => (
                    <Text
                      key={i}
                      style={{ ...type.caption, color: colors.textMuted, lineHeight: 17 }}
                    >
                      {`· ${line}`}
                    </Text>
                  ))}
                </View>
              ) : null}
              {finding.suggest ? (
                <Text style={{ ...type.caption, color: colors.textSecondary, lineHeight: 17 }}>
                  <Text style={{ ...type.caption, color: colors.primary }}>Suggests </Text>
                  {finding.suggest}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </PressableScale>
    </Reanimated.View>
  );
}
