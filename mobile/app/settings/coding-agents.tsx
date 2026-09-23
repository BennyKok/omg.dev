/**
 * Settings › Coding agents, native.
 *
 * Every agent the Computer reports, with its state. Claude Code and Codex are
 * connected right here, on the box, through ConnectAgentSheet. The rest live
 * on the Computer and say so. This replaced a row that opened the web
 * dashboard in Safari.
 */
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Icon, Row, Separator } from "../../src/components";
import { connectProviderFor, FALLBACK_KIND, listClaudeAccounts, type ClaudeAccount, type ConnectProvider } from "../../src/omg/agent-auth";
import { agentIcon } from "../../src/omg/agent-icons";
import { ConnectAgentSheet } from "../../src/omg/connect-agent-sheet";
import { PressableScale } from "../../src/omg/motion";
import { useOmg } from "../../src/omg/provider";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";

export default function CodingAgentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type, space } = useTheme();
  const { agents, client, readiness, probe, refreshModels, updateAllAgents } = useOmg();
  const ready = readiness?.status === "ready";
  const waking = readiness === null || readiness.status === "connecting" || readiness.status === "waking";

  const [connecting, setConnecting] = useState<{ provider: ConnectProvider; key: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const connect = useCallback((target: { provider: ConnectProvider; key: string }) => {
    setConnecting(target);
    setSheetOpen(true);
  }, []);
  const [accounts, setAccounts] = useState<ClaudeAccount[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadAccounts = useCallback(async () => {
    if (!client || !ready) return;
    const next = await listClaudeAccounts(client.transport).catch(() => null);
    if (next) setAccounts(next);
  }, [client, ready]);
  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([probe(), loadAccounts()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadAccounts, probe]);

  /** idle | running | done | an error message. */
  const [modelsState, setModelsState] = useState<"idle" | "running" | "done" | { error: string }>("idle");
  const runModelsRefresh = useCallback(async () => {
    if (modelsState === "running") return;
    setModelsState("running");
    try {
      await refreshModels();
      setModelsState("done");
    } catch (e) {
      setModelsState({ error: e instanceof Error ? e.message : "Could not refresh models" });
    }
  }, [modelsState, refreshModels]);

  const [updateState, setUpdateState] = useState<"idle" | "running" | "done" | { error: string }>("idle");
  const runUpdateAll = useCallback(async () => {
    if (updateState === "running") return;
    setUpdateState("running");
    try {
      await updateAllAgents();
      setUpdateState("done");
    } catch (e) {
      setUpdateState({ error: e instanceof Error ? e.message : "Could not update agents" });
    }
  }, [updateState, updateAllAgents]);

  const visible = useMemo(() => agents.filter((a) => a.visible !== false), [agents]);
  const connectedClaude = accounts.filter((a) => a.connected);

  return (
    <>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <Text style={{ ...type.callout, lineHeight: 22, color: colors.text2, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg }}>
          Sessions run on one of these. Sign in here. The sign-in happens on your Computer, and the token stays there.
        </Text>

        {visible.length === 0 ? (
          <Card>
            <Row>
              <Text style={{ ...type.callout, color: colors.textMuted, flex: 1 }}>
                {waking ? "Your Computer is starting up. Its agents appear here in a moment." : "No agents reported yet. Pull to refresh."}
              </Text>
            </Row>
          </Card>
        ) : (
          <Card>
            {visible.map((agent, i) => {
              const provider = connectProviderFor(agent.key);
              const connected = agent.status?.accountConnected === true;
              const detail =
                provider === "claude" && connected
                  ? connectedClaude.length > 1
                    ? `${connectedClaude.length} accounts connected`
                    : `Connected${connectedClaude[0]?.profile?.detail ? ` · ${connectedClaude[0].profile.detail}` : ""}`
                  : connected
                    ? "Connected"
                    : provider === "claude"
                      ? "Uses your Claude subscription"
                      : provider === "codex"
                        ? "Uses your ChatGPT plan"
                        : agent.status?.configured
                          ? "Ready on your Computer"
                          : "Set up on your Computer";
              const openDetail = provider === "claude" && connected;
              return (
                <View key={agent.key}>
                  {i > 0 ? <Separator inset={space.lg + 44 + space.md} /> : null}
                  <Row
                    onPress={
                      openDetail
                        ? () => router.push({ pathname: "/settings/agent", params: { kind: agent.key } })
                        : undefined
                    }
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        backgroundColor: colors.secondary,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Image source={agentIcon(agent.key)} style={{ width: 24, height: 24 }} resizeMode="contain" />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={{ ...type.headline, color: colors.text }}>{agent.label}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {connected || agent.status?.configured ? (
                          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success }} />
                        ) : null}
                        <Text style={{ ...type.footnote, color: connected ? colors.text2 : colors.textMuted }} numberOfLines={1}>
                          {detail}
                        </Text>
                      </View>
                    </View>
                    {provider && !connected ? (
                      <ConnectPill
                        label="Connect"
                        disabled={!ready}
                        onPress={() => connect({ provider, key: agent.key })}
                      />
                    ) : openDetail ? (
                      <Icon ios="chevron.right" android="chevron_right" size={14} weight="semibold" color={colors.textMuted} />
                    ) : null}
                  </Row>
                </View>
              );
            })}
          </Card>
        )}

        {/* A Computer that does not list Claude or Codex at all still gets a way in. */}
        {ready && !visible.some((a) => connectProviderFor(a.key)) ? (
          <Card style={{ marginTop: space.lg }}>
            {(["claude", "codex"] as const).map((provider, i) => (
              <View key={provider}>
                {i > 0 ? <Separator inset={space.lg} /> : null}
                <Row onPress={() => connect({ provider, key: FALLBACK_KIND[provider] })}>
                  <Text style={{ ...type.callout, color: colors.text, flex: 1 }}>
                    {provider === "claude" ? "Connect Claude Code" : "Connect Codex"}
                  </Text>
                  <Icon ios="chevron.right" android="chevron_right" size={14} weight="semibold" color={colors.textMuted} />
                </Row>
              </View>
            ))}
          </Card>
        ) : null}

        {ready ? (
          <Card style={{ marginTop: space.lg }}>
            <Row onPress={updateState === "running" ? undefined : () => void runUpdateAll()}>
              <Icon ios="arrow.down.circle" android="download" size={17} color={colors.text} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ ...type.callout, color: colors.text }}>Update all agents</Text>
                <Text style={{ ...type.footnote, color: typeof updateState === "object" ? colors.danger : colors.textMuted }} numberOfLines={2}>
                  {updateState === "running"
                    ? "Installing the latest version of each agent…"
                    : updateState === "done"
                      ? "All agents updated"
                      : typeof updateState === "object"
                        ? updateState.error
                        : "Install the latest version of every agent, then refresh models"}
                </Text>
              </View>
              {updateState === "running" ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
            </Row>
            <Separator inset={space.lg} />
            <Row onPress={modelsState === "running" ? undefined : () => void runModelsRefresh()}>
              <Icon ios="arrow.clockwise" android="refresh" size={17} color={colors.text} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ ...type.callout, color: colors.text }}>Refresh models</Text>
                <Text style={{ ...type.footnote, color: typeof modelsState === "object" ? colors.danger : colors.textMuted }} numberOfLines={2}>
                  {modelsState === "running"
                    ? "Asking each provider for its models…"
                    : modelsState === "done"
                      ? "Models refreshed"
                      : typeof modelsState === "object"
                        ? modelsState.error
                        : "Get the newest models from each provider"}
                </Text>
              </View>
              {modelsState === "running" ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
            </Row>
          </Card>
        ) : null}

        <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start", paddingHorizontal: space.lg, paddingTop: space.xl }}>
          <Icon ios="lock" android="lock" size={15} color={colors.text} />
          <Text style={{ ...type.footnote, lineHeight: 18, color: colors.text2, flex: 1 }}>
            Your Computer runs the sign-in itself. The agent writes its own token there. This phone only shows the page and passes the code along.
          </Text>
        </View>
      </ScrollView>

      {connecting ? (
        <ConnectAgentSheet
          visible={sheetOpen}
          provider={connecting.provider}
          agentKey={connecting.key}
          transport={client?.transport ?? null}
          onClose={() => setSheetOpen(false)}
          onConnected={refresh}
        />
      ) : null}
    </>
  );
}

function ConnectPill({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors, type, radius } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      scale={0.96}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: radius.pill,
        backgroundColor: colors.text,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ ...type.subhead, fontWeight: "600", color: colors.bg }}>{label}</Text>
    </PressableScale>
  );
}
