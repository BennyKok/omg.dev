/** A finding opened from Updates or a notification, with a route to its report. */
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { AndroidSymbol, SFSymbol } from "expo-symbols";
import { useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState, Icon, PrimaryButton } from "../../../src/components";
import { SeverityBadge } from "../../../src/omg/auto-agent-card";
import { useAutoAgents } from "../../../src/omg/auto-agents";
import { findingAge, startSessionFromFinding } from "../../../src/omg/auto-findings";
import { PressableScale } from "../../../src/omg/motion";
import { useOmg } from "../../../src/omg/provider";
import { Text } from "../../../src/omg/text";
import { useTheme } from "../../../src/omg/theme";
import { useToast } from "../../../src/omg/toast";
import { useAgentPicker } from "../../../src/omg/session-options";
import { AgentSetupSheet } from "../../../src/omg/agent-setup-sheet";

export default function AutoFindingScreen() {
  const params = useLocalSearchParams<{ agentId: string; findingId: string }>();
  const agentId = typeof params.agentId === "string" ? params.agentId : "";
  const findingId = typeof params.findingId === "string" ? params.findingId : "";
  const router = useRouter();
  const { colors, type, space, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { client } = useOmg();
  const toast = useToast();
  const { agents, findings, loading, findingsError, setFindingStatus, refresh } = useAutoAgents();
  const agent = agents.find((a) => a.id === agentId);
  const finding = findings.find((f) => f.id === findingId && f.agentId === agentId);
  const siblings = findings.filter((f) => f.agentId === agentId).length;
  const name = agent?.name ?? "Auto agent";
  const picker = useAgentPicker({
    initialAgent: agent?.agent ?? "aisdk", initialModel: agent?.model,
    initialThinking: agent?.thinkingLevel, initialClaudeAccountId: agent?.claudeAccountId,
  });
  const [setupOpen, setSetupOpen] = useState(false);
  const reportPath = `/auto/${encodeURIComponent(agentId)}`;
  const [action, setAction] = useState<"start" | "dismiss" | null>(null);
  const actionInFlight = useRef(false);
  const busy = action !== null;
  const firstSeen = finding?.createdAt ? findingAge({ ...finding, lastSeenAt: undefined }) : "";
  const openReport = () => router.dismissTo(reportPath);
  const leave = () => router.canGoBack() ? router.back() : router.replace("/");

  const startSession = async () => {
    if (!client || !finding || picker.loading || (loading && !agent) || actionInFlight.current) return;
    actionInFlight.current = true;
    setAction("start");
    try {
      const sessionId = await startSessionFromFinding(client, finding, agent, {
        agent: picker.agent, model: picker.model, thinkingLevel: picker.thinking,
        claudeAccountId: picker.claudeAccountId,
      });
      // A created session must still open if marking the finding fails. Staying
      // on the Start button in that case could create the same work twice.
      try {
        await setFindingStatus(finding.id, "session");
      } catch {
        toast.show("Session started. The finding could not be marked as handled.", { intent: "error" });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/session/${encodeURIComponent(sessionId)}`);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), { intent: "error" });
    } finally {
      actionInFlight.current = false;
      setAction(null);
    }
  };

  const dismiss = async () => {
    if (!finding || actionInFlight.current) return;
    actionInFlight.current = true;
    setAction("dismiss");
    try {
      await setFindingStatus(finding.id, "dismissed");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      leave();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e), { intent: "error" });
    } finally {
      actionInFlight.current = false;
      setAction(null);
    }
  };

  const copy = async () => {
    if (!finding || actionInFlight.current) return;
    const text = [finding.title,
      ...(finding.reasoning?.length ? ["", ...finding.reasoning.map((r) => `- ${r}`)] : []),
      ...(finding.suggest ? ["", `Suggested: ${finding.suggest}`] : []),
    ].join("\n");
    try {
      await Clipboard.setStringAsync(text);
      toast.show("Copied", { intent: "success" });
    } catch {
      toast.show("Could not copy the finding.", { intent: "error" });
    }
  };

  const footerAction = (label: string, ios: SFSymbol, android: AndroidSymbol, onPress: () => void) => (
    <PressableScale
      onPress={onPress}
      disabled={busy}
      scale={0.97}
      accessibilityRole="button"
      accessibilityLabel={`${label === "Dismissing…" ? "Dismiss" : label} finding`}
      accessibilityState={{ disabled: busy, busy: label === "Dismissing…" }}
      style={{ minWidth: 44, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, paddingHorizontal: space.sm, opacity: busy ? 0.5 : 1 }}
    >
      <Icon ios={ios} android={android} size={16} color={colors.textSecondary} />
      {label !== "Copy" ? <Text style={{ ...type.footnote, color: colors.textSecondary }}>{label}</Text> : null}
    </PressableScale>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: "Finding" }} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xl }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <PressableScale
          onPress={openReport}
          disabled={busy}
          scale={0.98}
          accessibilityRole="link"
          accessibilityLabel={`Open ${name} report, ${siblings} open findings`}
          style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: space.sm }}
        >
          <Text numberOfLines={1} style={{ ...type.footnote, color: colors.textSecondary, flex: 1 }}>
            {name} · {siblings} open{agent?.project ? ` · ${agent.project}` : ""}
          </Text>
          <Icon ios="chevron.right" android="chevron_right" size={14} color={colors.textMuted} />
        </PressableScale>

        {!finding ? (
          loading ? (
            <View style={{ paddingVertical: space.xl, alignItems: "center", gap: space.md }}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={{ ...type.callout, color: colors.textSecondary }}>Loading finding…</Text>
            </View>
          ) : findingsError ? (
            <View style={{ gap: space.md }}>
              <EmptyState title="Could not load this finding" detail={findingsError} />
              <PrimaryButton label="Try again" onPress={refresh} />
            </View>
          ) : (
            <View style={{ gap: space.md }}>
              <EmptyState title="This finding is no longer open" detail="It may have been dismissed or moved to a session." />
              <PrimaryButton label="View agent findings" onPress={openReport} />
            </View>
          )
        ) : (
          <>
            <View style={{ gap: space.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <SeverityBadge severity={finding.severity} />
                <Text style={{ ...type.footnote, color: colors.textSecondary, flex: 1 }}>
                  {firstSeen ? `First seen ${firstSeen === "now" ? "just now" : `${firstSeen} ago`}` : ""}
                  {(finding.occurrences ?? 1) > 1 ? ` · Seen ${finding.occurrences} times` : ""}
                </Text>
              </View>
              <Text selectable accessibilityRole="header" style={{ ...type.headline, fontSize: 18, color: colors.text }}>{finding.title}</Text>
            </View>
            {finding.reasoning?.length ? (
              <View style={{ gap: space.sm }}>
                <Text accessibilityRole="header" style={{ ...type.caption, color: colors.textSecondary }}>Why this matters</Text>
                {finding.reasoning.map((line, i) => (
                  <View key={i} style={{ flexDirection: "row", gap: space.sm }}>
                    <Text style={{ ...type.subhead, fontWeight: "400", lineHeight: 21, color: colors.textSecondary }}>•</Text>
                    <Text selectable style={{ ...type.subhead, fontWeight: "400", lineHeight: 21, color: colors.textSecondary, flex: 1 }}>{line}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {finding.suggest ? (
              <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong }}>
                <Text accessibilityRole="header" style={{ ...type.caption, color: colors.textSecondary }}>Suggested next step</Text>
                <Text selectable style={{ ...type.subhead, fontWeight: "400", lineHeight: 21, color: colors.textSecondary }}>{finding.suggest}</Text>
              </View>
            ) : !finding.reasoning?.length ? (
              <Text style={{ ...type.callout, color: colors.textSecondary }}>The agent did not include more details for this finding.</Text>
            ) : null}
            {findingsError ? (
              <Text accessibilityRole="alert" style={{ ...type.footnote, color: colors.warning }}>{findingsError}</Text>
            ) : null}
          </>
        )}
      </ScrollView>

      {finding ? (
        <View style={{ gap: space.xs, paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: insets.bottom + space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.bg }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <PressableScale
                onPress={() => setSetupOpen(true)} disabled={busy}
                accessibilityRole="button" accessibilityLabel={`Session agent ${picker.label}${picker.modelLabel ? `, ${picker.modelLabel}` : ""}. Change agent or model`}
                style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: space.xs }}
              >
                <Icon ios="slider.horizontal.3" android="tune" size={16} color={colors.textSecondary} />
                <Text numberOfLines={1} style={{ ...type.caption, color: colors.text, flex: 1 }}>
                  {picker.label}{picker.modelLabel ? ` · ${picker.modelLabel}` : ""}{picker.thinkingLabel ? ` · ${picker.thinkingLabel}` : ""}
                </Text>
                <Icon ios="chevron.up" android="keyboard_arrow_up" size={12} color={colors.textSecondary} />
              </PressableScale>
            </View>
            {footerAction("Copy", "doc.on.doc", "content_copy", () => void copy())}
            {footerAction(action === "dismiss" ? "Dismissing…" : "Dismiss", "xmark", "close", () => void dismiss())}
          </View>
          <PrimaryButton label="Start session" loading={action === "start"} disabled={busy || !client || picker.loading || (loading && !agent) || !picker.options.length} onPress={() => void startSession()} />
        </View>
      ) : null}
      <AgentSetupSheet visible={setupOpen && !busy} onClose={() => setSetupOpen(false)}
        title="Session agent" agentOptions={picker.options} modelOptions={picker.modelOptions}
        thinkingOptions={picker.thinkingOptions} accountOptions={picker.accountOptions}
        agentLabel={picker.label} modelLabel={picker.modelLabel} accountLabel={picker.claudeAccountLabel}
        action={{ label: "Done", onPress: () => setSetupOpen(false) }} />
    </View>
  );
}
