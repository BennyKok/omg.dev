/**
 * One connected Claude Code login on the Computer: what is signed in, and the
 * two things a person can do about it. Sign in as someone else, or sign out.
 *
 * Sign-out is `DELETE /api/coding-agents/claude/accounts/:id` on the box. The
 * box refuses with 409 while a session is using the account, and its message
 * says which, so that text is shown as is instead of being rewritten here.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Row, Separator } from "../../src/components";
import { listClaudeAccounts, removeClaudeAccount, type ClaudeAccount } from "../../src/omg/agent-auth";
import { agentIcon } from "../../src/omg/agent-icons";
import { ConnectAgentSheet } from "../../src/omg/connect-agent-sheet";
import { PressableScale } from "../../src/omg/motion";
import { useOmg } from "../../src/omg/provider";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";

export default function AgentDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type, space } = useTheme();
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const agentKey = typeof kind === "string" && kind ? kind : "claude";
  const { client, readiness, probe } = useOmg();
  const ready = readiness?.status === "ready";

  const [accounts, setAccounts] = useState<ClaudeAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!client || !ready) return;
    const next = await listClaudeAccounts(client.transport).catch(() => null);
    if (next) setAccounts(next);
  }, [client, ready]);
  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = useCallback(
    (account: ClaudeAccount) => {
      Alert.alert(
        `Disconnect ${account.profile?.label ?? account.label}?`,
        "This account is signed out on your Computer. Your Claude subscription is not changed. You can reconnect any time.",
        [
          { text: "Keep connected", style: "cancel" },
          {
            text: "Disconnect",
            style: "destructive",
            onPress: () => {
              if (!client) return;
              setBusy(account.id);
              void removeClaudeAccount(client.transport, account.id)
                .then(async (rest) => {
                  setAccounts(rest);
                  await probe();
                  if (!rest.some((a) => a.connected)) router.back();
                })
                .catch((e: unknown) => {
                  Alert.alert("Could not disconnect", e instanceof Error ? e.message : "Try again in a moment.");
                })
                .finally(() => setBusy(null));
            },
          },
        ],
      );
    },
    [client, probe, router],
  );

  return (
    <>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={{ alignItems: "center", gap: space.md, paddingTop: space.xl, paddingBottom: space.xl }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              backgroundColor: colors.card,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Image source={agentIcon(agentKey)} style={{ width: 36, height: 36 }} resizeMode="contain" />
          </View>
          <Text style={{ ...type.title, fontSize: 28, color: colors.text }}>Claude Code</Text>
        </View>

        {accounts === null ? (
          <ActivityIndicator color={colors.textMuted} />
        ) : accounts.length === 0 ? (
          <Card>
            <Row>
              <Text style={{ ...type.callout, color: colors.textMuted, flex: 1 }}>No Claude account is signed in on this Computer.</Text>
            </Row>
          </Card>
        ) : (
          <Card>
            {accounts.map((account, i) => (
              <View key={account.id}>
                {i > 0 ? <Separator inset={space.lg} /> : null}
                <Row>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ ...type.headline, color: colors.text }}>{account.profile?.label ?? account.label}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 4,
                          backgroundColor: account.connected ? colors.success : colors.warning,
                        }}
                      />
                      <Text style={{ ...type.footnote, color: colors.text2 }} numberOfLines={1}>
                        {account.connected
                          ? account.profile?.detail ?? "Connected"
                          : account.needsReconnect
                            ? "Needs to sign in again"
                            : "Not connected"}
                      </Text>
                    </View>
                  </View>
                  {account.fromEnv ? (
                    <Text style={{ ...type.footnote, color: colors.textMuted }}>From environment</Text>
                  ) : busy === account.id ? (
                    <ActivityIndicator size="small" color={colors.textMuted} />
                  ) : (
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel={`Disconnect ${account.profile?.label ?? account.label}`}
                      onPress={() => disconnect(account)}
                      scale={0.96}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 7,
                        borderRadius: 999,
                        borderWidth: 1.5,
                        borderColor: colors.danger,
                      }}
                    >
                      <Text style={{ ...type.subhead, fontWeight: "600", color: colors.danger }}>Disconnect</Text>
                    </PressableScale>
                  )}
                </Row>
              </View>
            ))}
          </Card>
        )}

        <Card style={{ marginTop: space.lg }}>
          <Row onPress={() => setAdding(true)} disabled={!ready}>
            <Text style={{ ...type.callout, color: colors.text, flex: 1 }}>Sign in with another account</Text>
          </Row>
        </Card>

        <Text style={{ ...type.footnote, lineHeight: 18, color: colors.text2, paddingHorizontal: space.lg, paddingTop: space.xl }}>
          The sign-in token lives on your Computer, not on this phone. Disconnecting signs the account out there. If a session is using it, close that session first.
        </Text>
      </ScrollView>

      <ConnectAgentSheet
        visible={adding}
        provider="claude"
        agentKey={agentKey}
        transport={client?.transport ?? null}
        onClose={() => setAdding(false)}
        onConnected={async () => {
          await Promise.all([load(), probe()]);
        }}
      />
    </>
  );
}
