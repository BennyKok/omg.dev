/**
 * One open finding, as a home-screen row — and, expanded, the two things you
 * can actually do about it.
 *
 * WHY THIS IS NOT A SessionCard. The two look alike on purpose — same card
 * shape, same density — because they sit in the same list and a person
 * should not have to learn a second visual language halfway down the screen.
 * But the affordances are different: there is no transcript to push to, and
 * a swipe here dismisses the FINDING, not a session (there isn't one yet).
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
 * TWO WAYS TO DISMISS, ON PURPOSE. The web's FindingSheet has a single
 * visible "Dismiss" button in its action row. A phone could offer that same
 * button AND nothing else, but this app already taught a swipe-to-archive
 * gesture for exactly this shape of action (SessionCard, components.tsx),
 * and a finding row sitting right below those session rows that suddenly
 * doesn't respond to the same swipe would be the inconsistency. So this row
 * does both: swipe to dismiss immediately (the fast, native path), or expand
 * and tap "Dismiss" (the discoverable, visible path — same label web uses).
 * Neither is hidden in favor of the other.
 *
 * TAPPING EXPANDS IT IN PLACE, exactly like the web sheet minus the launch
 * settings a phone row has no room for: full reasoning, the suggested fix,
 * and one button — Start session — which sends the same request the web's
 * one-tap "Make the change" does (see startSessionFromFinding in
 * app/index.tsx). Copy and Feedback stay web-only: Benny asked for two
 * interactions, not five.
 *
 * MOTION: `useListItemMotion()` and nothing else — no `exiting`, ever. See
 * the long note in motion.tsx. The expansion below changes this row's height
 * while a 30s poll may be resizing its siblings, and it is safe only because
 * `entering` and `layout` both END with the view in its correct flow
 * position. The dismiss swipe drives its own exit (translateX off-screen)
 * rather than asking Reanimated for one, the same reasoning SessionCard
 * documents for archive.
 */

import Reanimated from "react-native-reanimated";
import { type AndroidSymbol, type SFSymbol } from "expo-symbols";
import { View } from "react-native";

import { AgentAvatar, Icon } from "../components";
import { Text } from "./text";
import { useListItemMotion, PressableScale } from "./motion";
import { useSwipeToCommit } from "./swipe-row";
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

/** A quiet expanded-state action: an icon, a label, nothing louder than text. */
function RowAction({
  icon,
  androidIcon,
  label,
  onPress,
  disabled,
  tone = "default",
}: {
  icon: SFSymbol;
  androidIcon: AndroidSymbol;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "default" | "primary";
}) {
  const { colors, radius, type, space } = useTheme();
  const isPrimary = tone === "primary";
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      scale={0.97}
      dim={0.85}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.pill,
        backgroundColor: isPrimary ? colors.primary : colors.secondary,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Icon
        ios={icon}
        android={androidIcon}
        size={14}
        color={isPrimary ? colors.primaryForeground : colors.text}
      />
      <Text
        style={{
          ...type.footnote,
          fontWeight: "600",
          color: isPrimary ? colors.primaryForeground : colors.text,
        }}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

export function AutoFindingCard({
  row,
  expanded,
  onToggle,
  onDismiss,
  onStartSession,
  busy,
  animateEntry = true,
}: {
  row: AutoFindingRow;
  expanded: boolean;
  onToggle: () => void;
  /** Fire-and-forget from here — see setFindingStatus in auto-agents.ts. */
  onDismiss: () => void;
  /** Async so the button can show its own spinner while the session starts. */
  onStartSession: () => void;
  /** True while a session is being started FROM THIS finding. */
  busy?: boolean;
  /**
   * Skip BOTH the mount-in slide/fade AND the resettle-on-reflow transition
   * — see the identical flag on `SessionCard` for why. Suppressing only
   * `entering` and leaving `layout` live still measured a residual overlap
   * (1/5 cold loads in testing): the two independently-fetched sections
   * (`listSessions()` vs this hook's own `useAutoAgents()` fetch) can
   * straggle in more than one wave each, and a `layout` reflow racing a
   * still-settling sibling is the same class of transient position
   * corruption `entering` was. `app/index.tsx` passes `false` only for a
   * fixed window after the home screen mounts.
   */
  animateEntry?: boolean;
}) {
  const { colors, radius, type, space, motion } = useTheme();
  const listMotion = useListItemMotion();
  const { finding, agent } = row;
  const seen = finding.occurrences ?? 1;

  const corners = { borderRadius: radius.xl };

  // Swipe-to-dismiss — see useSwipeToCommit (swipe-row.ts) for the gesture
  // and arbitration reasoning. Same hook backs SessionCard's swipe-to-archive
  // in components.tsx: this used to be a second, byte-identical copy of the
  // PanResponder below, which is how the two drifted before this got
  // extracted.
  const { panResponder, cardStyle, revealStyle } = useSwipeToCommit({
    onCommit: onDismiss,
    fastDuration: motion.fast,
    quickDuration: motion.quick,
  });

  return (
    <Reanimated.View
      entering={animateEntry ? listMotion.entering : undefined}
      layout={animateEntry ? listMotion.layout : undefined}
    >
      <Reanimated.View
        pointerEvents="none"
        style={[
          revealStyle,
          {
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: colors.danger,
            ...corners,
            marginHorizontal: space.lg,
            alignItems: "flex-end",
            justifyContent: "center",
            paddingRight: space.xl,
          },
        ]}
      >
        <Icon ios="xmark" android="close" size={20} color="#ffffff" />
      </Reanimated.View>
      <Reanimated.View style={cardStyle} {...panResponder.panHandlers}>
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
              <Text
                numberOfLines={1}
                style={{ ...type.headline, color: colors.text, flexShrink: 1 }}
              >
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

                <View style={{ flexDirection: "row", gap: space.sm, paddingTop: space.xs }}>
                  <RowAction
                    icon="checkmark"
                    androidIcon="check"
                    label={busy ? "Starting…" : "Start session"}
                    onPress={onStartSession}
                    disabled={busy}
                    tone="primary"
                  />
                  <RowAction
                    icon="xmark"
                    androidIcon="close"
                    label="Dismiss"
                    onPress={onDismiss}
                    disabled={busy}
                  />
                </View>
              </View>
            ) : null}
          </View>
        </PressableScale>
      </Reanimated.View>
    </Reanimated.View>
  );
}
