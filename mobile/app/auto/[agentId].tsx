/**
 * An auto agent's report: the web's AgentReportSheet as a page.
 *
 * Name and schedule at the top with the worst severity, the count of open
 * findings, then one card per finding (age, severity, title, the suggested
 * fix in two lines) that opens the finding's own page. Edit schedule and
 * Dismiss all sit in a bar at the bottom, where the web keeps them.
 */
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState, Icon } from "../../src/components";
import { SeverityDot, worstSeverity } from "../../src/omg/auto-agent-card";
import { sortFindingRows, useAutoAgents } from "../../src/omg/auto-agents";
import { agentScheduleLine, findingAge } from "../../src/omg/auto-findings";
import { PressableScale } from "../../src/omg/motion";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";

export default function AutoAgentReportScreen() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>();
  const id = typeof agentId === "string" ? agentId : "";
  const router = useRouter();
  const { colors, type, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { agents, findings, tz, loading, setFindingStatus, refresh } = useAutoAgents();
  const agent = agents.find((a) => a.id === id);
  const open = useMemo(
    () => sortFindingRows(findings.filter((f) => f.agentId === id)),
    [findings, id],
  );
  const name = agent?.name ?? "Auto agent";
  const [dismissingAll, setDismissingAll] = useState(false);

  const dismissAll = () => {
    if (!open.length || dismissingAll) return;
    Alert.alert(
      `Dismiss ${open.length} finding${open.length === 1 ? "" : "s"}?`,
      "They leave the open list. The agent keeps running.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Dismiss all",
          style: "destructive",
          onPress: () => {
            setDismissingAll(true);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            void Promise.all(open.map((f) => setFindingStatus(f.id, "dismissed")))
              .then(() => refresh())
              .finally(() => {
                setDismissingAll(false);
                router.back();
              });
          },
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: `${name} report` }} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + 96 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ ...type.title, color: colors.text }}>{name}</Text>
            {agent ? (
              <Text style={{ ...type.footnote, color: colors.textMuted }}>
                {agentScheduleLine(agent, tz)}
              </Text>
            ) : null}
          </View>
          <View style={{ paddingTop: 10 }}>
            <SeverityDot severity={worstSeverity(open)} />
          </View>
        </View>

        <Text style={{ ...type.subhead, color: colors.textMuted }}>
          {`${open.length} open finding${open.length === 1 ? "" : "s"}`}
        </Text>

        {loading && !open.length ? (
          <ActivityIndicator color={colors.textMuted} />
        ) : !open.length ? (
          <EmptyState title="Nothing open" detail="This agent has no findings waiting on you." />
        ) : (
          open.map((finding) => (
            <PressableScale
              key={finding.id}
              onPress={() => router.push(`/auto/${encodeURIComponent(id)}/${encodeURIComponent(finding.id)}`)}
              scale={0.98}
              accessibilityRole="button"
              accessibilityLabel={`${name} finding: ${finding.title}`}
              style={({ pressed }) => ({
                gap: space.xs,
                padding: space.md,
                borderRadius: radius.xl,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.borderStrong,
                backgroundColor: pressed ? colors.cardPressed : colors.card,
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Text style={{ ...type.caption, color: colors.textMuted, flex: 1 }}>
                  {`${findingAge(finding)} ago`}
                </Text>
                <SeverityDot severity={finding.severity} />
                <Icon ios="chevron.right" android="chevron_right" size={12} color={colors.textMuted} />
              </View>
              <Text style={{ ...type.body, color: colors.text }}>{finding.title}</Text>
              {finding.suggest ? (
                <Text numberOfLines={2} style={{ ...type.footnote, color: colors.textMuted }}>
                  {finding.suggest}
                </Text>
              ) : null}
            </PressableScale>
          ))
        )}
      </ScrollView>

      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + space.sm,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          backgroundColor: colors.bg,
        }}
      >
        <PressableScale
          onPress={() => router.push("/schedules")}
          scale={0.97}
          accessibilityRole="button"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.lg,
            height: 44,
            borderRadius: radius.pill,
            backgroundColor: colors.secondary,
          }}
        >
          <Icon ios="slider.horizontal.3" android="tune" size={16} color={colors.text} />
          <Text style={{ ...type.callout, fontWeight: "600", color: colors.text }}>Edit schedule</Text>
        </PressableScale>
        <PressableScale
          onPress={dismissAll}
          disabled={!open.length || dismissingAll}
          scale={0.97}
          accessibilityRole="button"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.md,
            height: 44,
            opacity: open.length ? 1 : 0.5,
          }}
        >
          <Icon ios="xmark" android="close" size={14} color={colors.textMuted} />
          <Text style={{ ...type.callout, fontWeight: "600", color: colors.textMuted }}>Dismiss all</Text>
        </PressableScale>
      </View>
    </View>
  );
}
