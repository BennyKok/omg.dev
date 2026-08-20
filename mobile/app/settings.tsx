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
import { sharedBindingLabel } from "../src/omg/computer-shared-binding";
import {
  getStoredPushToken,
  pushPermissionStatus,
  registerForPushNotifications,
  unregisterForPushNotifications,
  type PushPermissionStatus,
} from "../src/omg/push";

/**
 * Account management that lives on the web. NOT billing — see below.
 *
 * NO PURCHASE LINKS IN THIS APP. There used to be a "Plan & billing" row here
 * opening `app.omg.dev/settings/billing`, and it has to stay gone until omg
 * sells through StoreKit.
 *
 * App Review Guideline 3.1.1(a): "In all other storefronts, except for the
 * United States storefront, where this prohibition does not apply, apps and
 * their metadata may not include buttons, external links, or other calls to
 * action that direct customers to purchasing mechanisms other than in-app
 * purchase." omg ships outside the US, so the exception does not cover us and
 * this row was the clearest possible example of the thing it prohibits.
 *
 * The rows that remain are account MANAGEMENT — which agents are connected,
 * what is scheduled, how much disk is used. None of them is a way to pay, and
 * 3.1.1 is aimed at purchasing, not at a companion app linking to its own
 * dashboard.
 *
 * The upgrade nudge is not lost, it MOVED. 3.1.3: "Developers can send
 * communications outside of the app to their user base about purchasing
 * methods other than in-app purchase." So running out of included time is
 * stated as a fact in the app and followed up by email, which is allowed in
 * every storefront.
 *
 * STOREKIT HAS NOW LANDED, and the honest fix arrived as predicted: the "Plan"
 * row in the Computer card pushes app/plan.tsx, an in-app purchase. The web
 * link did NOT come back and must not — an in-app paywall that also offers an
 * external checkout is the same 3.1.1(a) violation with an extra step.
 */
/**
 * Legal documents, on omg.dev rather than app.omg.dev.
 *
 * Guideline 5.1.1(i): "All apps must include a link to their privacy policy in
 * the App Store Connect metadata field AND within the app in an easily
 * accessible manner." The metadata half was already set; the in-app half was
 * simply absent — this app shipped with no privacy link anywhere in the binary,
 * which applies to every app and always has, not just subscription ones.
 *
 * These are a separate constant from WEB_PAGES on purpose. WEB_PAGES are
 * dashboard surfaces, sit under "These open omg.dev in your browser", and point
 * at app.omg.dev. These point at the PUBLIC site, because a reviewer has to be
 * able to open them while signed out — behind a dashboard login they would not
 * be "easily accessible" and arguably not accessible at all.
 *
 * Not a 3.1.1(a) concern: a legal document is not a purchasing mechanism. See
 * the account-deletion comment above for the full argument; the same reasoning
 * covers both, and Guideline 5.1.1(i) requires this one outright.
 */
const LEGAL_PAGES: { label: string; path: string }[] = [
  { label: "Privacy Policy", path: "/privacy" },
  { label: "Terms of Use", path: "/terms" },
];

const WEB_PAGES: { label: string; path: string }[] = [
  { label: "Coding agents", path: "/settings/computer/coding-agents" },
  { label: "Schedules", path: "/settings/computer/auto" },
  { label: "Storage", path: "/settings/computer/storage" },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors, type, space } = useTheme();
  const { user, client, signOut, bindings, sharedComputers, bindingId } = useOmg();
  const router = useRouter();

  const current = bindings.find((b) => b.id === bindingId);
  const currentShared = sharedComputers.find((c) => c.id === bindingId);
  // Same record the label resolved — a selected live share must not paint
  // idle just because `current` is owned-only and therefore undefined.
  const selectedMachine = current ?? currentShared;
  const machineName = current
    ? bindingLabel(current)
    : currentShared
      ? sharedBindingLabel(currentShared, sharedComputers)
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

  /**
   * signOut() now throws SignOutFailedError instead of silently no-oping
   * when the server didn't confirm the session was revoked (see auth.ts) —
   * `void signOut()` would have turned that into an unhandled rejection
   * with nothing shown on screen, which is its own version of the original
   * bug: the person taps Sign out, nothing visibly happens, and they have
   * no idea whether they're still signed in. signingOutRef guards against a
   * second tap firing a second request while the first is in flight.
   */
  const [signingOut, setSigningOut] = useState(false);
  const confirmSignOut = () => {
    Alert.alert("Sign out?", "You'll need a new sign-in code to get back in.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: () => {
          if (signingOut) return;
          setSigningOut(true);
          void signOut()
            .catch((err) => {
              Alert.alert(
                "Couldn't sign out",
                err instanceof Error
                  ? err.message
                  : "Something went wrong. Try again.",
              );
            })
            .finally(() => setSigningOut(false));
        },
      },
    ]);
  };

  /**
   * Account deletion. Required by App Store Guideline 5.1.1(v): "Apps that
   * support account creation must also offer account deletion", and it must be
   * INITIATED IN THE APP — a support address or a buried web page does not
   * satisfy it.
   *
   * ── This outbound app.omg.dev link is deliberate. Do not remove it. ──
   *
   * The header of this file exists because a "Plan & billing" row linking to
   * app.omg.dev was removed for Guideline 3.1.1(a), and #116 then argued at
   * length that an in-app paywall must not also offer an external checkout. So
   * an outbound link on this exact screen looks, at a glance, like precisely
   * the regression we spent two PRs eliminating. It is not.
   *
   * 3.1.1(a) prohibits calls to action that direct customers to PURCHASING
   * MECHANISMS other than in-app purchase. Deleting an account is not a
   * purchase, takes no money, and is the opposite of a conversion surface.
   * 5.1.1(v) affirmatively REQUIRES this entry point to exist. The two rules
   * do not conflict; one is about paying, the other about leaving.
   *
   * It is intentionally NOT in WEB_PAGES. Those rows are grouped under "These
   * open omg.dev in your browser" and read as convenience links to a companion
   * dashboard. This one is a destructive, guideline-mandated action and belongs
   * next to Sign out, where someone looking for it will actually find it.
   */
  const confirmDeleteAccount = () => {
    Alert.alert(
      "Delete account?",
      "This permanently deletes your omg account, your Computer, and everything on it. " +
        "You'll finish this in your browser.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => void Linking.openURL("https://app.omg.dev/settings/delete-account"),
        },
      ],
    );
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
          <StatusDot busy={selectedMachine?.online ?? false} />
          <Text style={{ ...type.callout, color: colors.text, flex: 1 }}>{machineName}</Text>
          <Icon
            ios="chevron.right"
            android="chevron_right"
            size={13}
            weight="semibold"
            color={colors.textMuted}
          />
        </Row>
        {/* THE ROW THAT REPLACES "Plan & billing".
            The removed one opened app.omg.dev/settings/billing, which is a call
            to action pointing at a purchasing mechanism other than in-app
            purchase — prohibited by 3.1.1(a) outside the US storefront. This
            one pushes an in-app StoreKit screen, which is the mechanism the
            guideline requires rather than one it forbids. That is the whole
            difference, and it is why the web link must not come back alongside
            it: a paywall with an external escape hatch is the same violation
            with an extra step. */}
        <Separator inset="text" />
        <Row onPress={() => router.push("/plan")}>
          <Text style={{ ...type.callout, color: colors.text, flex: 1 }}>Plan</Text>
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
            <Text style={{ ...type.callout, color: colors.danger, flex: 1 }}>
              {signingOut ? "Signing out…" : "Sign out"}
            </Text>
          </Row>
          <Row onPress={confirmDeleteAccount}>
            <Text style={{ ...type.callout, color: colors.danger, flex: 1 }}>Delete account</Text>
          </Row>
        </Card>
      </View>

      <SectionLabel>Legal</SectionLabel>
      <Card>
        {LEGAL_PAGES.map((page, i) => (
          <View key={page.path}>
            {/* inset={space.lg}, not "text" — same reason as WEB_PAGES above:
                no leading StatusDot/icon on these rows, and "text" mode budgets
                for one. */}
            {i > 0 ? <Separator inset={space.lg} /> : null}
            <Row onPress={() => void Linking.openURL(`https://omg.dev${page.path}`)}>
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
