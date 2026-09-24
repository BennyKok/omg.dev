/**
 * Settings › Connectors, native.
 *
 * omg's tested connectors (Gmail, Drive, Calendar, Sheets) and the accounts
 * connected to each. Everything connected here is for the whole team: every
 * member's agents can use it. Connections for one person or one role are made
 * on the web page, and this screen says how many there are.
 *
 * Connect opens the provider's page in an auth session. The provider returns
 * through the relay on auth.omg.dev to omg://connectors/oauth, and the code
 * goes straight to the Computer (src/omg/connectors.ts).
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Icon, Row, Separator } from "../../src/components";
import {
  connectForTeam,
  listApps,
  listConnectors,
  removeConnector,
  signIn,
  teamAccounts,
  TEAM,
  type Connector,
  type ConnectorApp,
} from "../../src/omg/connectors";
import { hasInAppBrowser } from "../../src/omg/in-app-browser";
import { PressableScale } from "../../src/omg/motion";
import { useOmg } from "../../src/omg/provider";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";

export default function ConnectorsScreen() {
  const insets = useSafeAreaInsets();
  const { colors, type, space } = useTheme();
  const { client, readiness } = useOmg();
  const ready = readiness?.status === "ready";
  const transport = client?.transport ?? null;

  const [apps, setApps] = useState<ConnectorApp[]>([]);
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!transport || !ready) return;
    try {
      const [a, c] = await Promise.all([listApps(transport), listConnectors(transport)]);
      setApps(a);
      setConnectors(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load connectors");
      setConnectors((prev) => prev ?? []);
    }
  }, [ready, transport]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const run = useCallback(
    async (key: string, work: () => Promise<unknown>) => {
      setBusy(key);
      setError(null);
      try {
        await work();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setBusy(null);
        await load();
      }
    },
    [load],
  );

  const manage = (c: Connector, app: ConnectorApp) => {
    if (!transport) return;
    Alert.alert(`${app.name}`, c.account ?? "Not signed in", [
      { text: "Reconnect", onPress: () => void run(c.id, () => signIn(transport, c.id)) },
      {
        text: "Remove for everyone",
        style: "destructive",
        onPress: () => void run(c.id, () => removeConnector(transport, c.id)),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const elsewhere = (connectors ?? []).filter((c) => c.owner !== TEAM).length;
  const canSignIn = hasInAppBrowser();

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      testID="connectors-screen"
    >
      <Text style={{ ...type.callout, lineHeight: 22, color: colors.text2, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg }}>
        Apps your agents can use. What you connect here works for everyone on your team.
      </Text>

      {!ready ? (
        <Card>
          <Row>
            <Text style={{ ...type.callout, color: colors.textMuted, flex: 1 }}>Your Computer is starting up. Connectors appear here in a moment.</Text>
          </Row>
        </Card>
      ) : connectors === null ? (
        <Card>
          <Row>
            <ActivityIndicator size="small" color={colors.textMuted} />
            <Text style={{ ...type.callout, color: colors.textMuted, flex: 1 }}>Loading connectors…</Text>
          </Row>
        </Card>
      ) : apps.length === 0 ? (
        // A Computer on older software answers without omg's tested list.
        <Card>
          <Row>
            <Text style={{ ...type.callout, color: colors.textMuted, flex: 1 }}>
              Your Computer's software is too old for connectors. Update it in Settings, under Software.
            </Text>
          </Row>
        </Card>
      ) : (
        <Card>
          {apps.map((app, i) => {
            const accounts = teamAccounts(connectors, app);
            const adding = busy === `add:${app.slug}`;
            return (
              <View key={app.slug} testID={`connector-app-${app.slug}`}>
                {i > 0 ? <Separator inset={space.lg + 44 + space.md} /> : null}
                <Row>
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
                    {app.icon ? <Image source={{ uri: app.icon }} style={{ width: 26, height: 26 }} resizeMode="contain" /> : null}
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ ...type.headline, color: colors.text }}>{app.name}</Text>
                    {accounts.length === 0 ? (
                      <Text style={{ ...type.footnote, color: colors.textMuted }} numberOfLines={2}>
                        {app.description}
                      </Text>
                    ) : null}
                  </View>
                  {adding ? (
                    <ActivityIndicator size="small" color={colors.textMuted} />
                  ) : (
                    <Pill
                      label={accounts.length ? "Add" : "Connect"}
                      a11y={accounts.length ? `Add another ${app.name} account` : `Connect ${app.name}`}
                      filled={accounts.length === 0}
                      disabled={!canSignIn || busy !== null}
                      onPress={() => transport && void run(`add:${app.slug}`, () => connectForTeam(transport, app))}
                    />
                  )}
                </Row>
                {accounts.map((c) => (
                  <Row key={c.id} onPress={() => manage(c, app)}>
                    <View style={{ width: 44 }} />
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                      <View
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 4,
                          backgroundColor: c.oauthConnected ? colors.success : colors.danger,
                        }}
                      />
                      <Text style={{ ...type.footnote, color: colors.text2, flex: 1 }} numberOfLines={1}>
                        {c.account ?? "Not signed in"}
                        {c.oauthConnected ? "" : " · needs sign-in"}
                      </Text>
                    </View>
                    {busy === c.id ? (
                      <ActivityIndicator size="small" color={colors.textMuted} />
                    ) : (
                      <Icon ios="ellipsis" android="more_horiz" size={15} color={colors.textMuted} />
                    )}
                  </Row>
                ))}
              </View>
            );
          })}
        </Card>
      )}

      {error ? (
        <Text style={{ ...type.footnote, color: colors.danger, paddingHorizontal: space.lg, paddingTop: space.md }}>{error}</Text>
      ) : null}

      {!canSignIn ? (
        <Text style={{ ...type.footnote, color: colors.textMuted, paddingHorizontal: space.lg, paddingTop: space.md }}>
          Update the app to connect from your phone.
        </Text>
      ) : null}

      {elsewhere > 0 ? (
        <Text style={{ ...type.footnote, lineHeight: 18, color: colors.textMuted, paddingHorizontal: space.lg, paddingTop: space.lg }}>
          {elsewhere === 1 ? "1 more connection is" : `${elsewhere} more connections are`} set up for one person or one role. Manage those on the web.
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start", paddingHorizontal: space.lg, paddingTop: space.xl }}>
        <Icon ios="lock" android="lock" size={15} color={colors.text} />
        <Text style={{ ...type.footnote, lineHeight: 18, color: colors.text2, flex: 1 }}>
          The sign-in finishes on your Computer. Its keys stay there. Agents use the apps but never see the keys.
        </Text>
      </View>
    </ScrollView>
  );
}

function Pill({ label, a11y, onPress, disabled, filled }: { label: string; a11y: string; onPress: () => void; disabled?: boolean; filled: boolean }) {
  const { colors, type, radius } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      disabled={disabled}
      scale={0.96}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: radius.pill,
        backgroundColor: filled ? colors.text : colors.secondary,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ ...type.subhead, fontWeight: "600", color: filled ? colors.bg : colors.text }}>{label}</Text>
    </PressableScale>
  );
}
