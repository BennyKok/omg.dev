/**
 * Settings, deliberately thin for v1.
 *
 * Everything that is genuinely account- or machine-level — coding agents,
 * schedules, storage, billing — already has a good screen on the web, and
 * those screens change often. Reimplementing them natively now would mean
 * maintaining two of each while the product is still moving. So this screen
 * owns identity and machine choice, and hands the rest to the web with an
 * obvious external-link affordance rather than pretending to be the whole
 * settings surface.
 */

import { useRouter } from "expo-router";
import Constants from "expo-constants";
import {
  Alert,
  Linking,
  ScrollView,
  Switch,
  View,
} from "react-native";
import { useCallback, useEffect, useState } from "react";
import { Text } from "../src/omg/text";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Icon, Row, SectionLabel, Separator, StatusDot } from "../src/components";
import { useOmg } from "../src/omg/provider";
import { useTheme } from "../src/omg/theme";
import { bindingLabel } from "../src/omg/format";
import { CLOUD_BINDING_ID } from "../src/omg/config";
import {
  getStoredPushToken,
  pushPermissionStatus,
  registerForPushNotifications,
  unregisterForPushNotifications,
  type PushPermissionStatus,
} from "../src/omg/push";

const WEB_PAGES: { label: string; path: string }[] = [
  { label: "Coding agents", path: "/settings/computer/coding-agents" },
  { label: "Schedules", path: "/settings/computer/auto" },
  { label: "Storage", path: "/settings/computer/storage" },
  { label: "Plan & billing", path: "/settings/billing" },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors, type, space } = useTheme();
  const { user, client, signOut, bindings, bindingId } = useOmg();
  const router = useRouter();

  const current = bindings.find((b) => b.id === bindingId);
  const machineName = current
    ? bindingLabel(current)
    : bindingId === CLOUD_BINDING_ID
      ? "Cloud computer"
      : "None selected";

  /**
   * "on" tracks whether THIS device has a live, registered token — not just
   * OS permission. iOS permission is a one-way ratchet (denied stays denied
   * until Settings.app), so the toggle's own state is what needs to survive
   * app restarts; the stored token (see push.ts) is what makes that possible
   * without re-minting one on every mount.
   */
  const [permission, setPermission] = useState<PushPermissionStatus | "loading">("loading");
  const [notificationsOn, setNotificationsOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [status, token] = await Promise.all([pushPermissionStatus(), getStoredPushToken()]);
      if (cancelled) return;
      setPermission(status);
      setNotificationsOn(status === "granted" && !!token);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const togglePush = useCallback(
    async (next: boolean) => {
      if (!client || pushBusy) return;
      setPushBusy(true);
      try {
        if (next) {
          const outcome = await registerForPushNotifications(client.transport, user?.email);
          if (outcome === "registered") {
            setPermission("granted");
            setNotificationsOn(true);
            return;
          }
          if (outcome === "denied") {
            setPermission("denied");
            return;
          }
          if (outcome === "unavailable") {
            Alert.alert(
              "Not available here",
              "Push notifications need a real device (not a simulator) and a build that includes them.",
            );
            return;
          }
          Alert.alert("Couldn't turn on notifications", "Check your connection and try again.");
        } else {
          await unregisterForPushNotifications(client.transport);
          setNotificationsOn(false);
        }
      } finally {
        setPushBusy(false);
      }
    },
    [client, pushBusy, user?.email],
  );

  const confirmSignOut = () => {
    Alert.alert("Sign out?", "You'll need a new sign-in code to get back in.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);
  };

  const open = (path: string) => void Linking.openURL(`https://app.omg.dev${path}`);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
      // The title is the system large title now, not a Text drawn at the top of
      // the scroll view, so this is what lets it collapse into the bar.
      contentInsetAdjustmentBehavior="automatic"
    >
      <SectionLabel>Account</SectionLabel>
      <Card>
        <Row>
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.callout, color: colors.text }}>
              {user?.email ?? "Signed in"}
            </Text>
          </View>
        </Row>
      </Card>

      <SectionLabel>Computer</SectionLabel>
      <Card>
        {/* This one pushes rather than opening the switcher menu. The header
            chip on Sessions is where you switch machines mid-task; Settings is
            where you manage them, and the screen is the only place pairing,
            per-machine detail and the blocked-plan reason have room. The
            chevron is honest here for the same reason it would have been a lie
            on a row that only opened a menu. */}
        <Row onPress={() => router.push("/computers")}>
          <StatusDot busy={current?.online ?? false} />
          <Text style={{ ...type.callout, color: colors.text, flex: 1 }}>{machineName}</Text>
          <Icon
            ios="chevron.right"
            android="chevron_right"
            size={13}
            weight="semibold"
            color={colors.textMuted}
          />
        </Row>
      </Card>

      {permission !== "unavailable" ? (
        <>
          <SectionLabel>Notifications</SectionLabel>
          <Card>
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.callout, color: colors.text }}>Push notifications</Text>
                {permission === "denied" ? (
                  <Text style={{ ...type.footnote, color: colors.textMuted, marginTop: 2 }}>
                    Blocked in iOS Settings — turn them on there first.
                  </Text>
                ) : null}
              </View>
              <Switch
                value={notificationsOn}
                onValueChange={(next) => void togglePush(next)}
                disabled={pushBusy || permission === "denied" || permission === "loading" || !client}
              />
            </Row>
          </Card>
          <Text
            style={{
              ...type.footnote,
              color: colors.textMuted,
              paddingHorizontal: space.lg,
              paddingTop: space.sm,
              lineHeight: 18,
            }}
          >
            An agent asking a question, a finished session, or something shipped — never the text
            itself, only which project it's about.
          </Text>
        </>
      ) : null}

      <SectionLabel>On the web</SectionLabel>
      <Card>
        {WEB_PAGES.map((page, i) => (
          <View key={page.path}>
            {/* No leading StatusDot/icon on this row — its text already sits
                flush with the card's own padding, so this is that padding,
                not "text" mode (which accounts for a leading dot). */}
            {i > 0 ? <Separator inset={space.lg} /> : null}
            <Row onPress={() => open(page.path)}>
              <Text style={{ ...type.callout, color: colors.text, flex: 1 }}>{page.label}</Text>
              <Icon
                ios="arrow.up.forward.app"
                android="open_in_new"
                size={15}
                color={colors.textMuted}
              />
            </Row>
          </View>
        ))}
      </Card>
      <Text
        style={{
          ...type.footnote,
          color: colors.textMuted,
          paddingHorizontal: space.lg,
          paddingTop: space.sm,
          lineHeight: 18,
        }}
      >
        These open omg.dev in your browser.
      </Text>

      <View style={{ marginTop: space.xl }}>
        <Card>
          <Row onPress={confirmSignOut}>
            <Text style={{ ...type.callout, color: colors.danger, flex: 1 }}>Sign out</Text>
          </Row>
        </Card>
      </View>

      <Text
        style={{
          ...type.caption,
          color: colors.textMuted,
          textAlign: "center",
          paddingTop: space.xl,
        }}
      >
        omg {Constants.expoConfig?.version ?? "1.0.0"}
      </Text>
    </ScrollView>
  );
}
