import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { AiConsentScreen, useAiDataConsent } from "../src/omg/ai-consent";
import { IntroScreen, SetupScreen, useIntro, useOnboarding } from "../src/omg/onboarding";
import { BrandMark } from "../src/omg/brand-mark";
import { LaunchScreen } from "../src/omg/launch";
import { useLucideFont } from "../src/omg/lucide";

import { OmgProvider, useOmg } from "../src/omg/provider";
import { useNotificationTapRouting } from "../src/omg/push";
import { useTheme } from "../src/omg/theme";
import { ToastProvider } from "../src/omg/toast";

/**
 * THE LAUNCH SCREEN IS THE MARK, BREATHING — not a mark with a spinner under it.
 *
 * A spinner says "this will take a while, and I am counting". Cold start here
 * is a cookie read and a bundled font, and on a warm start it is gone before
 * it can finish one rotation — so what it actually communicated was hesitation
 * the app does not have. iOS launch screens do not have spinners for the same
 * reason.
 *
 * The mark fades and swells very slightly instead: enough that the screen is
 * clearly alive rather than stuck, slow enough (1.6s a cycle) that it reads as
 * breathing rather than as a loading animation. Someone who never sees it —
 * the common case — loses nothing.
 *
 * `Easing.inOut` on both ends, because a linear pulse has a visible corner at
 * the turn and this is the one thing on screen.
 */
function Splash() {
  const { colors, isDark } = useTheme();
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [pulse]);

  const breathe = useAnimatedStyle(() => ({
    opacity: 0.55 + pulse.value * 0.45,
    transform: [{ scale: 0.97 + pulse.value * 0.03 }],
  }));

  return (
    <View style={[styles.splash, { backgroundColor: colors.bg }]}>
      <Reanimated.View style={breathe}>
        <BrandMark size={64} holeColor={colors.bg} />
      </Reanimated.View>
      <StatusBar style={isDark ? "light" : "dark"} />
    </View>
  );
}

/**
 * Holds the launch screen up until the app has something true to show, and
 * plays it out exactly once.
 *
 * ONCE is the important part. This covers the navigation bar as well as the
 * page — that is why it lives here and not inside the list screen — and a
 * full-screen cover that can come BACK would be intolerable every time a
 * machine reconnects. After the first hand-off the list owns its own
 * connecting states, inline, where they belong.
 */
function LaunchGate() {
  const { authStatus, readiness, bindingId, machinesLoaded } = useOmg();
  const [finished, setFinished] = useState(false);
  /**
   * A HARD CEILING ON HOLDING THE APP HOSTAGE.
   *
   * Everything below waits on the machine answering, and a machine that never
   * answers would leave this screen up forever — the app would look hung, with
   * no list, no error and no way to reach Settings to switch computers. After
   * eight seconds the surface underneath takes over and says what is wrong in
   * its own words, which it is built to do. The splash is a courtesy for the
   * common fast case, not a gate on using the app.
   */
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  /**
   * AUTH IS PART OF SETTLING, and leaving it out is what let the very screen
   * this exists to hide come back.
   *
   * `authStatus` is "loading" for the first moments of every cold start, so a
   * condition that began with `=== "signed-in"` was FALSE exactly then — the
   * gate decided it had nothing to wait for, played its exit into an app that
   * knew nothing yet, and unmounted for good. By the time the account and its
   * computers arrived, the list was on screen saying "Connecting to No
   * computer…" with no cover left to hide it. Reported from the device twice.
   */
  const settling =
    !expired &&
    (authStatus === "loading" ||
      (authStatus === "signed-in" &&
        (!machinesLoaded ||
          (!!bindingId &&
            (readiness === null ||
              readiness.status === "connecting" ||
              readiness.status === "waking")))));

  if (finished) return null;

  return (
    <LaunchScreen
      /**
       * NEVER NAMES A MACHINE. The name is the thing that is not loaded yet
       * at the moment this screen exists, which is how the old copy ended up
       * reading "Connecting to No computer…".
       */
      label={
        readiness?.status === "waking"
          ? "Waking your computer"
          : machinesLoaded && bindingId
            ? "Connecting"
            : "Setting things up"
      }
      done={!settling}
      onFinished={() => setFinished(true)}
    />
  );
}

function RootNavigator() {
  const { authStatus, signOut, user, readiness, bindings, cloud, machinesLoaded, machinesError } =
    useOmg();
  const consent = useAiDataConsent(user?.id ?? null);
  const onboarding = useOnboarding(user?.id ?? null);
  const intro = useIntro();

  /*
   * Who is already established, by Benny's rule: an existing Computer OR a
   * non-free plan. There is no completed-onboarding flag on the server, so
   * these two observable facts are the predicate.
   *
   * `cloud.plan` is only trusted when it is a non-empty string that is not
   * "free". Unknown is NOT established: a null plan during a slow first load
   * would otherwise suppress setup for the exact new account it exists for.
   * Erring toward showing it costs a Skip; erring the other way costs the
   * whole flow, silently.
   */
  const hasComputer = (bindings?.length ?? 0) > 0;
  const cloudPlan = cloud?.plan;
  const paidPlan = typeof cloudPlan === "string" && cloudPlan !== "" && cloudPlan !== "free";
  const established = hasComputer || paidPlan;

  /*
   * Write the flag for an established account so this stops being asked on
   * every launch, and so a later downgrade to free cannot resurrect a welcome
   * flow for someone who has used the app for months.
   *
   * In an EFFECT, not in render. Calling onboarding.complete() while rendering
   * is a state update during render, which React either warns about or turns
   * into a re-render loop depending on where it lands.
   */
  useEffect(() => {
    if (onboarding.state === "needed" && machinesLoaded && established) onboarding.complete();
  }, [onboarding, machinesLoaded, established]);
  /**
   * A tapped notification goes to the thing it is about.
   *
   * The hook call is unconditional, as hooks must be, but the NAVIGATION is
   * gated on being signed in: a cold start launched by tapping a notification
   * delivers the tap before there is a signed-in Stack to push into — this
   * component is still returning <Splash/> at that moment, with no navigator
   * mounted at all. `useLastNotificationResponse` holds the response until it
   * is consumed, so gating waits rather than pushing into a tree that does not
   * exist yet.
   */
  /*
   * Gated on consent as well as auth. While the consent gate is showing there
   * is NO navigator mounted -- the gate returns a plain View, not a Stack -- so
   * a notification tap routed here would push into a tree that does not exist.
   * `useLastNotificationResponse` holds the response until it is consumed, so
   * waiting costs nothing and the tap still lands after the gate clears.
   */
  useNotificationTapRouting(authStatus === "signed-in" && consent.state === "granted");
  /**
   * Land on sign-in the moment ANY path sets authStatus to "signed-out" —
   * an explicit Sign out, a session that expired underneath the app, a
   * future 401 handler, all of it. Centralized here instead of next to one
   * call site (e.g. inside provider.tsx's signOut()) on purpose: a fix that
   * only fires for the Settings sign-out button leaves every OTHER path to
   * signed-out re-creating the exact bug this exists to close.
   *
   * Why this is needed at all, confirmed on-device: `Stack.Protected`
   * changes which screens are REGISTERED per authStatus (see the
   * signed-out Stack below — "settings" isn't declared there), but that is
   * not the same as telling expo-router to NAVIGATE anywhere. Without this,
   * a confirmed sign-out from Settings left Settings on screen rendering
   * the now-cleared (signed-out) provider state — right values, wrong
   * screen. `dismissTo` pops through whatever was pushed (Settings,
   * Computers, a session, ...) back to sign-in in one step regardless of
   * stack depth.
   *
   * Gated on the TRANSITION (previous render was "signed-in"), not just
   * "authStatus is currently signed-out" — a cold start that resolves
   * straight to signed-out already mounts the signed-out Stack fresh with
   * sign-in as its only screen; there is no stale signed-in screen to
   * escape from, so nothing here should run.
   */
  const previousAuthStatusRef = useRef(authStatus);
  useEffect(() => {
    const wasSignedIn = previousAuthStatusRef.current === "signed-in";
    previousAuthStatusRef.current = authStatus;
    if (wasSignedIn && authStatus === "signed-out") {
      router.dismissTo("/sign-in");
    }
  }, [authStatus]);
  const { colors, isDark } = useTheme();
  // Shares the splash with auth, rather than flashing an icon-less bar for a
  // frame: the font resolves from a bundled asset, so this is never a wait
  // the user can perceive on a warm start.
  /*
   * Declining signs out. `signOut` can REJECT -- it throws SignOutFailedError
   * when the server did not confirm the session was revoked -- and an unhandled
   * rejection here would leave the person staring at the consent screen with no
   * feedback and no way forward. So the local state is cleared either way: the
   * gate must never become a dead end, and a session that outlives the device's
   * belief about it is the ordinary signed-out recovery path anyway.
   */
  const handleDecline = useCallback(() => {
    void signOut().catch(() => {});
  }, [signOut]);

  const glyphsReady = useLucideFont();

  if (authStatus === "loading" || !glyphsReady) {
    return <Splash />;
  }

  if (authStatus === "signed-out") {
    /*
     * The intro lives INSIDE the signed-out branch, deliberately.
     *
     * It has to run before sign-in, and the obvious way to do that is a gate
     * above this branch. That is exactly the shape of the #237 splash
     * deadlock: a condition above the signed-out branch went permanently true
     * and made sign-in unreachable, with no way out but reinstalling. Nesting
     * it here cannot do that. Whatever the intro decides, this branch still
     * owns the signed-out tree, and both of the intro's controls — Continue on
     * the last panel, and Skip on every panel — resolve to the same thing:
     * mark it seen and fall through to the sign-in Stack below.
     *
     * It is also skipped entirely while its own read is in flight rather than
     * showing a splash, because a returning user reinstalling should reach the
     * email field without a flash of the pitch.
     */
    if (intro.state === "needed") {
      return (
        <>
          <StatusBar style={isDark ? "light" : "dark"} />
          <IntroScreen onSignIn={intro.complete} />
        </>
      );
    }
    return (
      <>
        <StatusBar style={isDark ? "light" : "dark"} />
        {/*
         * `key="signed-out"` — belt, not the actual buckle.
         *
         * This Stack and the signed-in one below declare two DIFFERENT sets
         * of screens — "settings", "computers", etc. exist only in the
         * signed-in tree. Without a key, React sees the same element type
         * (Stack) in the same position across a signed-in -> signed-out
         * render and reconciles it as an UPDATE to the existing navigator
         * rather than a fresh mount: the native stack's navigation STATE
         * can survive, including "the current route is settings", even
         * though "settings" is no longer among this tree's declared
         * screens.
         *
         * TESTED ALONE, ON-DEVICE, AND IT WAS NOT ENOUGH: adding just this
         * key still left a real sign-out showing Settings with nulled-out
         * data (account row fell back to "Signed in", computer to "None
         * selected") instead of landing on sign-in — changing which screens
         * are registered is still not the same as telling expo-router to
         * navigate anywhere, key or no key. The actual fix is the
         * `router.dismissTo("/sign-in")` effect above, which acts on
         * expo-router's own href tracking directly. This key is kept as
         * cheap, correct-anyway hygiene — it makes the signed-in/signed-out
         * boundary an honest fresh mount instead of an in-place screen-list
         * swap — not because it redirects anything by itself.
         */}
        <Stack key="signed-out" screenOptions={{ contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Protected guard>
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          </Stack.Protected>
          {/*
           * EVERY non-sign-in route, not just these two.
           *
           * expo-router 57 auto-registers any file route that is not explicitly
           * protected, so listing a subset left `computers`, `settings`,
           * `plan`, `notifications` and the whole `bots` tree reachable by deep
           * link while signed out. `bots/[id]` reuses the composer, dictation
           * and attachments. The old comment claiming sign-in was this Stack's
           * only screen was simply wrong.
           *
           * Adding a file under app/ therefore means adding it HERE too.
           */}
          <Stack.Protected guard={false}>
            <Stack.Screen name="index" options={{ title: "Sessions" }} />
            <Stack.Screen name="session/[id]" options={{ title: "Session" }} />
            <Stack.Screen name="computers" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="plan" />
            <Stack.Screen name="bots/index" />
            <Stack.Screen name="bots/new" />
            <Stack.Screen name="bots/[id]/index" />
            <Stack.Screen name="bots/[id]/edit" />
          </Stack.Protected>
        </Stack>
      </>
    );
  }

  /*
   * Guidelines 5.1.1(i) and 5.1.2(i) rejected 1.0 (34): the app shared personal
   * data with third-party AI services without disclosing it in the app and
   * asking first. So the gate sits HERE, in front of the entire signed-in
   * tree — above the composer, dictation and attachments alike — rather than
   * on any one send path. One screen that cannot be routed around beats three
   * checks that can each be forgotten.
   *
   * It is deliberately BELOW the signed-out branch. Someone who is not signed
   * in cannot transmit anything, so asking them first would be a consent
   * prompt with nothing behind it.
   *
   * THE `loading` CHECK MUST ALSO SIT BELOW IT, and that is not a style
   * preference. It used to be folded into the first Splash condition, above
   * the signed-out branch:
   *
   *     if (authStatus === "loading" || !glyphsReady || consent.state === "loading")
   *
   * Consent is keyed by account id, so signing out returns the hook to
   * `loading` and it stays there — there is no account to read a grant for.
   * That made the splash condition permanently true and the signed-out branch
   * unreachable: sign out, and the app hung on the splash until it was
   * reinstalled. Keep every consent check below the signed-out branch.
   */
  if (consent.state === "loading") {
    return <Splash />;
  }

  if (consent.state === "needed") {
    return (
      <>
        <StatusBar style={isDark ? "light" : "dark"} />
        <AiConsentScreen onAccept={consent.accept} onDecline={handleDecline} />
      </>
    );
  }

  /*
   * Onboarding, after consent and below the signed-out branch.
   *
   * Order matters twice. It is below signed-out for the reason spelled out
   * above: any gate above that branch can make sign-in unreachable, which is
   * exactly the splash deadlock #237 fixed. It is below consent because
   * consent is the precondition for sending anything anywhere, and explaining
   * the product to someone who then declines and gets signed out is wasted.
   *
   * Like consent, this parks in "loading" until there is a user id, so it
   * cannot flash for the moment between signed-in and the account resolving.
   */
  if (onboarding.state === "loading") {
    return <Splash />;
  }

  /*
   * Setup is for people who do not have this yet.
   *
   * Benny's rule: an existing Computer OR a non-free plan means established,
   * and an established account must not be walked through connect and plans
   * again. There is no completed-onboarding flag on the server to lean on, so
   * these two observable facts are the predicate.
   *
   * `plan` is only trusted once it is a non-empty string that is not "free".
   * Unknown is NOT treated as established: a null plan on a slow first load
   * would otherwise silently suppress setup for the exact new account it
   * exists for. Erring toward showing it costs a Skip; erring the other way
   * costs the whole flow, silently.
   */
  /*
   * Do not judge before the machines have loaded. `bindings` is empty during
   * the first fetch as well as when there genuinely is no Computer, and those
   * two states are opposite answers to the question this predicate asks. An
   * established user would otherwise see setup flash before it resolved.
   * A load ERROR is not a reason to wait forever, so that falls through and
   * the predicate runs on what we have.
   */
  if (onboarding.state === "needed" && !machinesLoaded && !machinesError) {
    return <Splash />;
  }

  if (onboarding.state === "needed" && !established) {
    /*
     * The roster is whatever the Computer has told us so far. `waking` is a
     * real answer, not an error, so the screen says "starting up" instead of
     * drawing an empty list that reads as "no agents exist".
     */
    const roster =
      readiness?.status === "ready"
        ? readiness.roster.agents
            .filter((a) => a.visible !== false)
            .map((a) => ({
              key: a.key,
              label: a.label,
              connected: a.status?.accountConnected === true,
            }))
        : [];
    const waking = readiness === null || readiness.status === "connecting" || readiness.status === "waking";
    return (
      <>
        <StatusBar style={isDark ? "light" : "dark"} />
        <SetupScreen onDone={onboarding.complete} agents={roster} waking={waking} />
      </>
    );
  }


  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        key="signed-in"
        screenOptions={{
          /**
           * The nav bar is left to the system material.
           *
           * `headerStyle: { backgroundColor: colors.bg }` forced it opaque,
           * which flattens the one piece of chrome iOS is most opinionated
           * about: a real UINavigationBar is translucent, samples what scrolls
           * under it, and grows a hairline only once content is behind it.
           * Painting it a flat hex threw all of that away and left a bar that
           * merely sat above the page instead of belonging to it.
           *
           * `headerTransparent` + `headerBlurEffect` hands it back to UIKit,
           * and the blur follows the system appearance on its own — which is
           * also why it does not need a colour from us. The screens under it
           * set `contentInsetAdjustmentBehavior="automatic"` so their content
           * insets below the bar rather than starting under it.
           */
          /**
           * Both halves of this are load-bearing, and each was wrong alone.
           *
           * `headerTransparent` on its own means "draw NO background", not
           * "use the system material" — the bar became a hole and the
           * transcript scrolled up into the title, both unreadable. Dropping
           * it instead fell back to the navigator's default, which is LIGHT:
           * a white bar in a black app with an invisible title, because
           * expo-router's stack knows nothing about our palette.
           *
           * `headerBlurEffect` is what actually asks UIKit for its own
           * translucent chrome material, and it has to be told which
           * appearance to use. RNScreens warns this may overlap iOS 26's
           * scroll edge effect; the overlap is cosmetic, a hole and a white
           * bar are not.
           */
          /**
           * `headerTransparent` is NOT how you ask for the system material,
           * and using it cost us the large title.
           *
           * RNSScreenStackHeaderConfig.mm maps the two props separately:
           * `headerTransparent` sets `edgesForExtendedLayout = UIRectEdgeAll`,
           * which makes the screen's content view extend UNDER the bar; only
           * `headerStyle.backgroundColor` with alpha 0 reaches
           * `configureWithTransparentBackground`, and only then does
           * `appearance.backgroundEffect` (the blur) actually show, because an
           * opaque background paints over it.
           *
           * So `headerTransparent: true` alone gave us the worst of both: the
           * bar kept an opaque appearance, and the screen's black ScrollView
           * was laid out on top of the large title. The title was there the
           * whole time, drawn underneath the page — which is why the home
           * screen showed a tall empty band with a seam at its bottom edge and
           * no "Sessions" anywhere.
           *
           * The combination below is the one UIKit actually wants here: an
           * ordinary (non-extended) layout so the title has the band to
           * itself, and the bar painted with the page colour so bar and page
           * read as one surface. The blur is dropped deliberately — a blur
           * needs something to sample, and with a non-extended layout there is
           * nothing behind the bar, so it resolved to a flat mid-grey slab
           * that looked worse than either. The hairline still appears on
           * scroll, which is the only cue that actually carries meaning.
           *
           * MEASURED, 2026-08-14, iPhone 17 Pro sim (iOS 26.0), dark
           * appearance. The full translucent combination was tried again —
           * `headerTransparent: true` + alpha-0 `headerStyle` +
           * `headerBlurEffect` + a page-colour View behind the navigator — and
           * it is WORSE than what is here. Two probes, both on-device:
           *
           *  1. Wrapper View painted red, `contentStyle` semi-transparent
           *     green. NO red was visible anywhere. The screen's content view
           *     covers the wrapper completely, so "paint the page behind the
           *     navigator" buys nothing; the page colour simply stops being
           *     drawn and the light system material shows through instead.
           *     That is why the whole app turned light grey while the palette
           *     stayed dark, leaving muted text unreadable.
           *  2. `headerLargeTitleStyle` set to red. The title rendered as a
           *     faint red SMUDGE inside the band — it is drawn UNDER the blur,
           *     not over it, so "Sessions" stays illegible no matter what
           *     colour it is given.
           *
           * So the blur samples correctly (probe 1 showed the green darkening
           * under the bar), but the large title is on the wrong side of it.
           * Do not reach for `headerBlurEffect` here again without a device
           * screenshot proving the title is legible.
           */
          headerTransparent: false,
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          /**
           * `headerTintColor` colours the back chevron and the COLLAPSED title
           * only. The large title is a separate label with its own style, and
           * its default is the system label colour resolved against the
           * navigator's light appearance — i.e. black. In a black app that is
           * an invisible title once it is on screen at all. Same root cause as
           * the white bar above: the stack knows nothing about our palette
           * unless told.
           */
          headerLargeTitleStyle: { color: colors.text },
          headerBackButtonDisplayMode: "minimal",
          // The single place a screen background is painted. Every screen used
          // to re-paint colors.bg on its own root on top of this, which is the
          // double layering: two identical fills, and any disagreement between
          // them showing up as a seam mid-transition.
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Protected guard={false}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard>
          {/* Both this and session/[id] set the rest of their header options
              from inside the screen, because the items on the right need screen
              state (the machine button here, the session overflow there).

              No title on the list: see app/index.tsx. Empty here too, so it
              does not flash "Sessions" for the frame before that screen's
              layout effect runs. */}
          <Stack.Screen name="index" options={{ title: "" }} />
          <Stack.Screen name="session/[id]" options={{ title: "Session" }} />
          {/* Switching machines is the frequent action and belongs in the menu
              on the machine chip; pairing and per-machine detail still need a
              screen. See computer-picker.ts for why both exist. */}
          <Stack.Screen
            name="computers"
            options={{ title: "Computers", headerLargeTitle: true }}
          />
          <Stack.Screen
            name="settings"
            options={{ title: "Settings", headerLargeTitle: true }}
          />
          {/* Questions waiting on you, and what shipped. Pushed from the
              greeting, which is where the web puts the same door. */}
          <Stack.Screen
            name="notifications"
            options={{ title: "Notifications", headerLargeTitle: true }}
          />
          {/* Bots roster. `bots/[id]` (bot chat) is a later phase — see
              app/bots/index.tsx's own doc comment for the navigation
              reasoning and why this is a header icon button, not a rail
              toggle. */}
          <Stack.Screen name="bots/index" options={{ title: "Bots", headerLargeTitle: true }} />
          {/* Full-page, onboarding-style create and edit — no system header;
              each screen draws its own back control (+ progress, on create)
              via FlowHeader in bot-fields.tsx.
              `gestureEnabled: false` ONLY on the wizard, and only because its
              header chevron means "back one step" while the OS swipe gesture
              would mean something else — two controls disagreeing about what
              "back" means on the same screen. See bot-create-flow.tsx.
              Edit is an ordinary full-page screen and keeps the native
              swipe-back gesture; it guards unsaved changes itself
              (`beforeRemove` in bot-edit-screen.tsx) rather than by
              disabling a gesture iOS users reach for reflexively. */}
          <Stack.Screen name="bots/new" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="bots/[id]/edit" options={{ headerShown: false }} />
          {/* In-app purchase. Pushed from the blocked cloud computer and from
              Settings — the two places someone learns they need to pay. It is
              a normal pushed screen rather than a modal so the back gesture
              behaves the same as everywhere else. */}
          <Stack.Screen name="plan" options={{ title: "Subscription", headerLargeTitle: true }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function Layout() {
  const { isDark } = useTheme();
  return (
    <OmgProvider>
      {/**
       * TELL THE NAVIGATOR WHICH APPEARANCE THIS APP IS IN. It cannot see the
       * palette, and its default is LIGHT.
       *
       * This is the root cause of a class of bugs this app had been patching
       * one symptom at a time: the white navigation bar, the invisible large
       * title, and — the one that found it — a system menu that came up light
       * grey with black text in a black app, but only when its trigger sat in
       * the bar. expo-router's native stack derives the header's UIKit
       * appearance from THIS theme (`experimental_userInterfaceStyle: dark ?
       * "dark" : "light"` in useHeaderConfigProps), which becomes
       * `navigationBar.overrideUserInterfaceStyle`. Everything UIKit draws for
       * the bar — its material, and any menu presented from a view inside it —
       * then follows that override rather than the window.
       *
       * Explicit colours (headerTintColor, headerLargeTitleStyle) fixed the
       * things we paint ourselves; they could never fix the things the system
       * paints. Naming the appearance once here does both.
       */}
      <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
        {/* Above RootNavigator so the banner overlays every screen's header and
            content instead of being clipped by whichever Stack.Screen owns the
            view underneath it. */}
        <ToastProvider>
          <RootNavigator />
          {/* Above the navigator so it covers the bar too — see LaunchGate. */}
          <LaunchGate />
        </ToastProvider>
      </ThemeProvider>
    </OmgProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },

});
