/**
 * One finding, as the web's FindingDetail page: the way back to the report,
 * the agent and the age with the severity, the title, the reasoning, the
 * suggested fix, and the actions in a bar at the bottom. "Make the change"
 * starts a session on the finding's own agent, model and folder.
 */
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { AndroidSymbol, SFSymbol } from "expo-symbols";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, PrimaryButton } from "../../../src/components";
import { SeverityDot } from "../../../src/omg/auto-agent-card";
import { useAutoAgents } from "../../../src/omg/auto-agents";
import { findingAge, startSessionFromFinding } from "../../../src/omg/auto-findings";
import { PressableScale } from "../../../src/omg/motion";
import { useOmg } from "../../../src/omg/provider";
import { Text } from "../../../src/omg/text";
import { useTheme } from "../../../src/omg/theme";
import { useToast } from "../../../src/omg/toast";

export default function AutoFindingScreen() {
  const params = useLocalSearchParams<{ agentId: string; findingId: string }>();
  const agentId = typeof params.agentId === "string" ? params.agentId : "";
  const findingId = typeof params.findingId === "string" ? params.findingId : "";
  const router = useRouter();
  const { colors, type, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { client } = useOmg();
  const toast = useToast();
  const { agents, findings, setFindingStatus, refresh } = useAutoAgents();
  const agent = agents.find((a) => a.id === agentId);
  const finding = findings.find((f) => f.id === findingId);
  const siblings = findings.filter((f) => f.agentId === agentId).length;
  const name = agent?.name ?? "Auto agent";
  const [starting, setStarting] = useState(false);

  const makeTheChange = async () => {
    if (!client || !finding || starting) return;
    setStarting(true);
    try {
      const sessionId = await startSessionFromFinding(client, finding, agent);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await setFindingStatus(finding.id, "session");
      refresh();
      if (sessionId) router.replace(`/session/${sessionId}`);
      else router.back();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const dismiss = () => {
    if (!finding) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void setFindingStatus(finding.id, "dismissed").then(() => refresh());
    router.back();
  };

  const copy = async () => {
    if (!finding) return;
    const text = [
      finding.title,
      ...(finding.reasoning?.length ? ["", ...finding.reasoning.map((r) => `- ${r}`)] : []),
      ...(finding.suggest ? ["", `Suggested: ${finding.suggest}`] : []),
    ].join("\n");
    await Clipboard.setStringAsync(text);
    void Haptics.selectionAsync();
    toast.show("Copied");
  };

  const footerAction = (
    label: string,
    ios: SFSymbol,
    android: AndroidSymbol,
    onPress: () => void,
  ) => (
    <PressableScale
      onPress={onPress}
      scale={0.97}
      accessibilityRole="button"
      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: space.sm }}
    >
      <Icon ios={ios} android={android} size={14} color={colors.textMuted} />
      <Text style={{ ...type.footnote, fontWeight: "500", color: colors.textMuted }}>{label}</Text>
    </PressableScale>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: `${name} finding` }} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: insets.bottom + 140 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <PressableScale
          onPress={() => router.back()}
          scale={0.98}
          accessibilityRole="button"
          style={{ flexDirection: "row", alignItems: "center", gap: space.xs, alignSelf: "flex-start" }}
        >
          <Icon ios="chevron.left" android="chevron_left" size={12} color={colors.textMuted} />
          <Text style={{ ...type.callout, color: colors.textMuted }}>{`All ${siblings} from ${name}`}</Text>
        </PressableScale>

        {!finding ? (
          <Text style={{ ...type.callout, color: colors.textMuted }}>
            This finding is no longer open.
          </Text>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Text style={{ ...type.callout, color: colors.textSecondary }}>{name}</Text>
              <Text style={{ ...type.callout, color: colors.textMuted }}>{`· ${findingAge(finding)}`}</Text>
              <View style={{ flex: 1 }} />
              <SeverityDot severity={finding.severity} />
            </View>
            <Text selectable style={{ ...type.title, color: colors.text }}>{finding.title}</Text>
            {finding.reasoning?.length ? (
              <View style={{ gap: space.sm }}>
                {finding.reasoning.map((line, i) => (
                  <View key={i} style={{ flexDirection: "row", gap: space.sm }}>
                    <Text style={{ ...type.callout, color: colors.textMuted }}>•</Text>
                    <Text selectable style={{ ...type.callout, color: colors.textMuted, flex: 1, lineHeight: 22 }}>
                      {line}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {finding.suggest ? (
              <View
                style={{
                  gap: space.xs,
                  padding: space.md,
                  borderRadius: radius.xl,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.borderStrong,
                  backgroundColor: colors.card,
                }}
              >
                <Text style={{ ...type.overline, color: colors.textMuted }}>SUGGESTED</Text>
                <Text selectable style={{ ...type.callout, color: colors.text, lineHeight: 22 }}>
                  {finding.suggest}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {finding ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            gap: space.sm,
            paddingHorizontal: space.lg,
            paddingTop: space.md,
            paddingBottom: insets.bottom + space.sm,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            backgroundColor: colors.bg,
          }}
        >
          <PrimaryButton
            label={starting ? "Starting…" : "Make the change"}
            loading={starting}
            onPress={() => void makeTheChange()}
          />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            {footerAction("Copy", "doc.on.doc", "content_copy", () => void copy())}
            {footerAction("Dismiss", "xmark", "close", dismiss)}
          </View>
        </View>
      ) : null}
    </View>
  );
}
