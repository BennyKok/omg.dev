/**
 * An auto agent's report: the web's AgentReportSheet as a page.
 *
 * Name and schedule at the top, then compact finding rows with severity,
 * title, suggestion and age, matching the web report list. Edit schedule and
 * Dismiss all sit in a bar at the bottom, where the web keeps them.
 */
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState, Icon, PrimaryButton } from "../../src/components";
import { SeverityDot } from "../../src/omg/auto-agent-card";
import { sortFindingRows, useAutoAgents } from "../../src/omg/auto-agents";
import { agentScheduleLine, findingAge } from "../../src/omg/auto-findings";
import { PressableScale } from "../../src/omg/motion";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";
import { useToast } from "../../src/omg/toast";

export default function AutoAgentReportScreen() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>();
  const id = typeof agentId === "string" ? agentId : "";
  const router = useRouter();
  const { colors, type, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { agents, findings, tz, loading, findingsError, setFindingStatus, refresh } = useAutoAgents();
  const toast = useToast();
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
            void Promise.allSettled(open.map((f) => setFindingStatus(f.id, "dismissed")))
              .then((results) => {
                refresh();
                const failed = results.filter((r) => r.status === "rejected").length;
                if (failed) toast.show(`${failed} finding${failed === 1 ? "" : "s"} could not be dismissed. Please try again.`, { intent: "error" });
                else if (router.canGoBack()) router.back();
                else router.replace("/");
              })
              .finally(() => {
                setDismissingAll(false);
              });
          },
        },
      ],
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "Findings" }} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: space.xl }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ ...type.headline, color: colors.text }}>{name}</Text>
            {agent ? (
              <Text style={{ ...type.footnote, color: colors.textMuted }}>
                {agentScheduleLine(agent, tz)}
              </Text>
            ) : null}
          </View>
        </View>

        <Text style={{ ...type.caption, color: colors.textMuted }}>
          {loading && !open.length ? "Loading findings…" : `${open.length} open finding${open.length === 1 ? "" : "s"}`}
        </Text>

        {loading && !open.length ? (
          <ActivityIndicator color={colors.textMuted} />
        ) : findingsError && !open.length ? (
          <View style={{ gap: space.md }}>
            <EmptyState title="Could not load findings" detail={findingsError} />
            <PrimaryButton label="Try again" onPress={refresh} />
          </View>
        ) : !open.length ? (
          <EmptyState title="Nothing open" detail="This agent has no findings waiting on you." />
        ) : (
          open.map((finding) => (
            <PressableScale
              key={finding.id}
              onPress={() => router.push(`/auto/${encodeURIComponent(id)}/${encodeURIComponent(finding.id)}`)}
              scale={0.98}
              disabled={dismissingAll}
              accessibilityRole="button"
              accessibilityLabel={`${name} finding: ${finding.title}. ${finding.severity ?? "Unknown"} severity`}
              style={({ pressed }) => ({
                flexDirection: "row", alignItems: "flex-start", gap: space.sm,
                paddingHorizontal: space.sm, paddingVertical: space.sm, minHeight: 44,
                borderRadius: radius.md,
                backgroundColor: pressed ? colors.cardPressed : "transparent",
              })}
            >
              <View style={{ paddingTop: 5 }}><SeverityDot severity={finding.severity} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text numberOfLines={2} style={{ ...type.footnote, fontSize: 14, fontWeight: "500", color: colors.text }}>{finding.title}</Text>
                {finding.suggest ? (
                  <Text numberOfLines={2} style={{ ...type.caption, fontWeight: "400", color: colors.textSecondary }}>{finding.suggest}</Text>
                ) : null}
                <Text style={{ ...type.caption, fontSize: 11, fontWeight: "400", color: colors.textMuted }}>
                  {findingAge(finding) === "now" ? "Just now" : `${findingAge(finding)} ago`}
                  {(finding.occurrences ?? 1) > 1 ? ` · seen ${finding.occurrences}×` : ""}
                </Text>
              </View>
              <Icon ios="chevron.right" android="chevron_right" size={12} color={colors.textMuted} />
            </PressableScale>
          ))
        )}
      </ScrollView>

      <View
        style={{
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
          disabled={dismissingAll}
          scale={0.97}
          accessibilityRole="button"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.lg,
            minHeight: 44,
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
            minHeight: 44,
            opacity: open.length ? 1 : 0.5,
          }}
        >
          <Icon ios="xmark" android="close" size={14} color={colors.textMuted} />
          <Text style={{ ...type.callout, fontWeight: "600", color: colors.textMuted }}>{dismissingAll ? "Dismissing…" : "Dismiss all"}</Text>
        </PressableScale>
      </View>
    </View>
  );
}
