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

import { useRouter, useFocusEffect } from "expo-router";
import { reloadAppAsync } from "expo";
import Constants from "expo-constants";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  View,
} from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text } from "../src/omg/text";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, GROUPED_INSET, Icon, Row, SectionLabel, Separator, SettingsIcon, StatusDot } from "../src/components";
import { useOmg } from "../src/omg/provider";
import { useTheme } from "../src/omg/theme";
import { cloudComputerLabel, bindingLabel } from "../src/omg/format";
import { CLOUD_BINDING_ID } from "../src/omg/config";
import { useDemoMode } from "../src/omg/demo";
import { sharedBindingLabel } from "../src/omg/computer-shared-binding";
import { useComputerUpdate } from "../src/omg/computer-update";
import { ConnectionDebugSection } from "../src/omg/connection-debug-section";
import { ComputerSoftwareRow } from "../src/omg/computer-software-row";
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
 * STOREKIT HAS NOW LANDED, and the honest fix arrived as predicted: the
 * "Subscription and plan" row in the Computer card pushes app/plan.tsx, an
 * in-app purchase. The web link did NOT come back and must not — an in-app
 * paywall that also offers an external checkout is the same 3.1.1(a) violation
 * with an extra step.
 *
 * THE ROW IS NAMED FOR THE REVIEWER, NOT FOR US. It read "Plan", under a
 * heading reading "Computer", and App Review rejected 1.0 (34) under guideline
 * 2.1(b) saying they "cannot locate the In-App Purchases within the app".
 * Nothing on the path to the paywall contained the word subscription. Someone
 * hunting for in-app purchases had no reason to open a row called Plan. Do not
 * rename this back to something shorter.
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

const WEB_PAGES: {
  label: string;
  path: string;
  glyph: { ios: string; android: string };
  tint: keyof typeof TINT;
}[] = [
  // One tile per destination. A column of identical globes tells you only
  // that these rows leave the app, which the trailing glyph already says.
  {
    label: "Schedules",
    path: "/settings/computer/auto",
    glyph: { ios: "calendar", android: "calendar_month" },
    tint: "red",
  },
  {
    label: "Storage",
    path: "/settings/computer/storage",
    glyph: { ios: "internaldrive", android: "storage" },
    tint: "grey",
  },
];

/**
 * iOS's own tile colours for a settings row. Flat system colours, not our
 * brand palette: the tile's job is to make a row findable by colour in a list
 * you scroll past, which only works if it matches the muscle memory the rest
 * of the phone builds. Values are the iOS dark-appearance system colours.
 */
const TINT = {
  grey: "#8e8e93",
  blue: "#0a84ff",
  green: "#30d158",
  orange: "#ff9f0a",
  red: "#ff453a",
  purple: "#5e5ce6",
} as const;

/**
 * A grouped-list row: tile, title, optional trailing value, chevron.
 *
 * The chevron is drawn only when the row goes somewhere. A row with a value
 * and no chevron is a fact; a row with both is a destination — that
 * distinction is load-bearing in iOS and worth keeping honest here.
 */
function SettingsRow({
  glyph,
  lucide,
  tint,
  label,
  value,
  onPress,
  children,
}: {
  glyph?: { ios: string; android: string };
  lucide?: string;
  tint: string;
  label: string;
  value?: string | null;
  onPress?: () => void;
  /** A control that replaces the value and the chevron, such as a Switch. */
  children?: React.ReactNode;
}) {
  const { colors, type } = useTheme();
  return (
    <Row
      onPress={onPress}
      icon={
        <SettingsIcon tint={tint}>
          {lucide ? (
            <Icon lucide={lucide as never} size={17} color="#ffffff" />
          ) : (
            <Icon ios={glyph!.ios as never} android={glyph!.android as never} size={17} color="#ffffff" />
          )}
        </SettingsIcon>
      }
    >
      {/* 17pt regular is the iOS row label. Our `body` is 16, tuned for the
          dense session list, and a settings list is not that. */}
      <Text style={{ fontSize: 17, color: colors.text, flex: 1 }} numberOfLines={1}>
        {label}
      </Text>
      {children ?? (
        <>
          {value ? (
            <Text style={{ fontSize: 17, color: colors.textMuted }} numberOfLines={1}>
              {value}
            </Text>
          ) : null}
          {onPress ? (
            <Icon
              ios="chevron.right"
              android="chevron_right"
              size={13}
              weight="semibold"
              color={colors.textMuted}
            />
          ) : null}
        </>
      )}
    </Row>
  );
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { colors, type, space } = useTheme();
  const { user, client, signOut, bindings, sharedComputers, bindingId, cloud } = useOmg();
  const demo = useDemoMode();
  const router = useRouter();
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  // The Demo mode toggle fills the app with fake data, which is exactly wrong
  // for a real user and exactly right for an App Store screenshot. So it is
  // hidden behind the version footer: dev builds show it outright, and a
  // release build reveals it after seven taps — the same gesture Android uses
  // for its build number, chosen because nobody reaches it by accident. Once
  // demo mode is already on (env or a prior unlock), the section stays shown.
  const [devUnlocked, setDevUnlocked] = useState(__DEV__ || demo.value);
  const versionTaps = useRef(0);
  const revealDeveloper = useCallback(() => {
    if (devUnlocked) return;
    versionTaps.current += 1;
    if (versionTaps.current >= 7) setDevUnlocked(true);
  }, [devUnlocked]);

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
        ? cloudComputerLabel(cloud)
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
  /**
   * THE COMPUTER'S OWN SOFTWARE VERSION, and the button that changes it.
   *
   * The version shows even when there is nothing to do, because "which version
   * is my computer running" is a question you ask when nothing is wrong. Only
   * the button is conditional. See computer-software-row.tsx for the rest.
   */
  const updater = useComputerUpdate(client?.transport ?? null);

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
        <SettingsRow
          glyph={{ ios: "person.crop.circle.fill", android: "account_circle" }}
          tint={TINT.grey}
          label={user?.email ?? "Signed in"}
        />
      </Card>

      <SectionLabel>Computer</SectionLabel>
      <Card>
        {/* This one pushes rather than opening the switcher menu. The header
            chip on Sessions is where you switch machines mid-task; Settings is
            where you manage them, and the screen is the only place pairing,
            per-machine detail and the blocked-plan reason have room. The
            chevron is honest here for the same reason it would have been a lie
            on a row that only opened a menu. */}
        <SettingsRow
          glyph={{ ios: "desktopcomputer", android: "computer" }}
          tint={TINT.blue}
          label="Computer"
          onPress={() => router.push("/computers")}
        >
          {/* The dot stays: "which computer" and "is it up" are one glance in
              this app, and the value text alone cannot carry the second. */}
          <StatusDot busy={selectedMachine?.online ?? false} />
          <Text style={{ fontSize: 17, color: colors.textMuted }} numberOfLines={1}>
            {machineName}
          </Text>
          <Icon
            ios="chevron.right"
            android="chevron_right"
            size={13}
            weight="semibold"
            color={colors.textMuted}
          />
        </SettingsRow>
        <Separator inset="icon" />
        <SettingsRow
          glyph={{ ios: "display", android: "desktop_windows" }}
          tint={TINT.green}
          label="Control Computer"
          onPress={() => router.push("/computer")}
        />
        {/* THE ROW THAT REPLACES "Plan & billing".
            The removed one opened app.omg.dev/settings/billing, which is a call
            to action pointing at a purchasing mechanism other than in-app
            purchase — prohibited by 3.1.1(a) outside the US storefront. This
            one pushes an in-app StoreKit screen, which is the mechanism the
            guideline requires rather than one it forbids. That is the whole
            difference, and it is why the web link must not come back alongside
            it: a paywall with an external escape hatch is the same violation
            with an extra step. */}
        <Separator inset="icon" />
        <SettingsRow
          glyph={{ ios: "cpu", android: "memory" }}
          tint={TINT.purple}
          label="Coding agents"
          onPress={() => router.push("/settings/coding-agents")}
        />
        <Separator inset="icon" />
        <SettingsRow
          glyph={{ ios: "square.grid.2x2.fill", android: "apps" }}
          tint={TINT.orange}
          label="Connectors"
          onPress={() => router.push("/settings/connectors")}
        />
        <Separator inset="icon" />
        <SettingsRow
          glyph={{ ios: "creditcard.fill", android: "credit_card" }}
          tint={TINT.green}
          label="Subscription and plan"
          onPress={() => router.push("/plan")}
        />
        <ComputerSoftwareRow
          install={updater.install}
          loading={updater.loading}
          busy={updater.busy}
          restarting={updater.restarting}
          error={updater.error}
          onCheck={() => void updater.check(true)}
          onApply={() => void updater.apply()}
        />
      </Card>

      {permission !== "unavailable" ? (
        <>
          <SectionLabel>Notifications</SectionLabel>
          <Card>
            <Row icon={
              <SettingsIcon tint={TINT.red}>
                <Icon ios="bell.badge.fill" android="notifications" size={17} color="#ffffff" />
              </SettingsIcon>
            }>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, color: colors.text }}>Push notifications</Text>
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
              // Tracks the card, like the section label above it.
              paddingHorizontal: GROUPED_INSET + 8,
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
            {i > 0 ? <Separator inset="icon" /> : null}
            <Row
              onPress={() => open(page.path)}
              icon={
                <SettingsIcon tint={TINT[page.tint]}>
                  <Icon
                    ios={page.glyph.ios as never}
                    android={page.glyph.android as never}
                    size={17}
                    color="#ffffff"
                  />
                </SettingsIcon>
              }
            >
              <Text style={{ fontSize: 17, color: colors.text, flex: 1 }}>{page.label}</Text>
              {/* Not a chevron: this row leaves the app for Safari, and the
                  two must not look like the same kind of destination. */}
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
          paddingHorizontal: GROUPED_INSET + 8,
          paddingTop: space.sm,
          lineHeight: 18,
        }}
      >
        These open omg.dev in your browser.
      </Text>

      <SectionLabel>Help</SectionLabel>
      <Card>
        <SettingsRow
          glyph={{ ios: "sparkles", android: "auto_awesome" }}
          tint={TINT.orange}
          label="Replay the welcome tour"
          onPress={() => router.push("/onboarding")}
        />
      </Card>

      <ConnectionDebugSection transport={client?.transport ?? null} active={focused} cloud={bindingId === CLOUD_BINDING_ID} demo={demo.value} />

      {devUnlocked ? (
        <>
          <SectionLabel>Developer</SectionLabel>
          <Card>
            <Row icon={
              <SettingsIcon tint={TINT.grey}>
                <Icon ios="hammer.fill" android="build" size={17} color="#ffffff" />
              </SettingsIcon>
            }>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, color: colors.text }}>Demo mode</Text>
                <Text style={{ ...type.footnote, color: colors.textMuted, marginTop: 2 }}>
                  Fills every screen with seeded content for screenshots. Reloads the app.
                </Text>
              </View>
              <Switch
                value={demo.value}
                disabled={demo.locked}
                onValueChange={(next) => {
                  void demo.set(next).then(() => reloadAppAsync());
                }}
              />
            </Row>
          </Card>
        </>
      ) : null}

      <View style={{ marginTop: space.xl }}>
        <Card>
          {/* No tiles on these two, which is what iOS does with Sign Out: a
              destructive row is identified by its red label, and giving it a
              coloured tile would file it alongside the places you navigate to.
              They were also missing the separator every other pair has. */}
          <Row onPress={confirmSignOut}>
            <Text style={{ fontSize: 17, color: colors.danger, flex: 1 }}>
              {signingOut ? "Signing out…" : "Sign out"}
            </Text>
          </Row>
          <Separator inset={space.lg} />
          <Row onPress={confirmDeleteAccount}>
            <Text style={{ fontSize: 17, color: colors.danger, flex: 1 }}>Delete account</Text>
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
              <Text style={{ fontSize: 17, color: colors.text, flex: 1 }}>{page.label}</Text>
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

      <Pressable onPress={revealDeveloper}>
        <Text
          style={{
            ...type.caption,
            color: colors.textMuted,
            textAlign: "center",
            paddingTop: space.xl,
          }}
        >
          omg {Constants.expoConfig?.version ?? "1.0.0"}
          {devUnlocked ? " · developer" : ""}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
