import { sessionCache } from "../src/omg/session-cache-store";
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from "expo-router";
import { IpadWorkspaceLayout } from "../src/omg/sessions-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform, StyleSheet, View } from "react-native";
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { AiConsentScreen, useAiDataConsent } from "../src/omg/ai-consent";
import {
  rosterFromReadiness,
  useIntro,
  useOnboarding,
} from "../src/omg/onboarding";
import { BrandWordmark } from "../src/omg/brand-mark";
import { LaunchBackdrop, LaunchScreen } from "../src/omg/launch";
import { useLucideFont } from "../src/omg/lucide";

import { OmgProvider, useOmg } from "../src/omg/provider";
import { loadDemoMode } from "../src/omg/demo";
import { AgentVillageWidgetBridge } from "../src/omg/village-widget-bridge";
import { AgentLiveActivityBridge } from "../src/omg/agent-live-activity";
import { OnboardingAfterSignIn } from "../src/omg/onboarding-after";
import { OnboardingFlow, WelcomeGate, type OnboardingChoice } from "../src/omg/onboarding-flow";
import { isNewAccount, shouldMarkOnboarded, shouldShowSetup } from "../src/omg/onboarding-gate";
import { stashOnboardingChoice } from "../src/omg/onboarding-handoff";
import { registerForPushNotifications, useNotificationTapRouting } from "../src/omg/push";
import { useRootOpenRouting } from "../src/omg/root-open";
import { useAppIntentRouting } from "../src/omg/app-intent-routing";
import { useOtaUpdates } from "../src/omg/ota";
import { launch } from "../src/omg/palette";
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
  const { isDark } = useTheme();
  const launchTokens = isDark ? launch.dark : launch.light;
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

  /**
   * SAME SURFACE AS LaunchScreen, borrowed rather than rebuilt.
   *
   * This screen and the launch screen are both "the app opening", and a second
   * hand-rolled copy of the background is how one of them ends up on last
   * quarter's colours. The backdrop is LaunchScreen's; only the caption and the
   * exit are missing, because this one has nothing to say and no hand-off to
   * play — it simply stops being rendered.
   */
  return (
    <LaunchBackdrop>
      <View style={styles.splash}>
        <Reanimated.View style={breathe}>
          {/* The same lockup LaunchScreen shows, so the two cannot diverge. */}
          <BrandWordmark size={40} color={launchTokens.text} holeColor={launchTokens.bg} />
        </Reanimated.View>
      </View>
      <StatusBar style={isDark ? "light" : "dark"} />
    </LaunchBackdrop>
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
  const cachedRoster = bindingId ? sessionCache.read<unknown[]>(`roster:${bindingId}`) : null;
  const canShowSaved = Array.isArray(cachedRoster) && cachedRoster.length > 0;
  const settling =
    !expired &&
    (authStatus === "loading" ||
      (authStatus === "signed-in" && !canShowSaved &&
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

/**
 * Open a session, but not before there is a navigator to open it in.
 *
 * The onboarding paywall's exits leave the gate AND want to land on the session
 * the flow created, and those two cannot happen in the same tick: while a gate
 * is rendering there is no Stack, so a `router.push` from inside one pushes
 * into a tree that does not exist. Rendering this INSIDE the signed-in tree
 * means its effect cannot run until the Stack above it is mounted, whatever
 * else had to clear first -- setup, a slow plan read, anything added later.
 */
function OpenWhenMounted({ sessionId, onOpened }: { sessionId: string; onOpened: () => void }) {
  const { colors } = useTheme();
  useEffect(() => {
    /*
     * No slide, and a cover until it is open (Benny, 2026-09-24). The pricing
     * page used to hand over to Home for about a second while the session
     * slid in over it: a screen from after onboarding, shown in the middle of
     * it. `arrive=instant` turns the push animation off (see the session
     * Stack.Screen), and the cover in the flow's own colour hides the one or
     * two frames of Home before the session paints.
     */
    router.push(`/session/${sessionId}?arrive=instant`);
    const timer = setTimeout(onOpened, 350);
    return () => clearTimeout(timer);
  }, [sessionId, onOpened]);
  return <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]} />;
}

function RootNavigator() {
  const { authStatus, signOut, user, readiness, bindings, bindingId, cloud, client, machinesLoaded, machinesError, probe } =
    useOmg();
  const consent = useAiDataConsent(user?.id ?? null);
  const onboarding = useOnboarding(user?.id ?? null);
  const intro = useIntro();

  /*
   * Steps 04 to 06 are over for this launch. Local, not persisted: the flow is
   * driven by the one-shot handoff stash, so a relaunch cannot repeat it -- and
   * a persisted flag would be a second source of truth for the same fact.
   */
  const [afterSignInDone, setAfterSignInDone] = useState(false);
  /** The signed-in questions (steps 02 and 03) are answered for this launch. */
  const [questionsDone, setQuestionsDone] = useState(false);
  /**
   * The choice the questions just produced: step 04 shows its prompt at once,
   * and "Not now" on the data notice reopens the prompt with it.
   */
  const [questionsChoice, setQuestionsChoice] = useState<OnboardingChoice | null>(null);
  const questionsPrompt = questionsChoice?.prompt.trim() || null;
  /**
   * The new flow actually ran for this person, so setup below still owes them
   * a visit -- even though buying a plan in step 06 has just made `established`
   * true. Without this, paying would skip the connect step that Benny put
   * AFTER the paywall on purpose, and only for the people who paid.
   */
  const [newArrival, setNewArrival] = useState(false);
  const endAfterSignIn = useCallback((ran: boolean) => {
    if (ran) setNewArrival(true);
    setAfterSignInDone(true);
  }, []);
  /** Where the finished flow wants to land, held until a navigator exists. */
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const clearPendingSession = useCallback(() => setPendingSession(null), []);

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
  /*
   * The account's own creation time, from the session. `true` is a new
   * sign-up, `false` a returning customer, `null` unknown (the machines rule
   * below then decides alone). Read once per render; the window is an hour, so
   * a flip mid-flow is not a real case.
   */
  const newAccount = isNewAccount(user?.createdAt);
  /*
   * A returning customer counts as established even on the free plan with no
   * Computer of their own. Benny, 2026-09-24: an account that already exists
   * skips onboarding.
   */
  const established = hasComputer || paidPlan || newAccount === false;

  /*
   * Write the flag for an established account so this stops being asked on
   * every launch, and so a later downgrade to free cannot resurrect a welcome
   * flow for someone who has used the app for months.
   *
   * In an EFFECT, not in render. Calling onboarding.complete() while rendering
   * is a state update during render, which React either warns about or turns
   * into a re-render loop depending on where it lands.
   */
  // Both predicates live in onboarding-gate.ts with the rule they encode, and
  // are pinned by scripts/onboarding-gate.native-check.ts.
  const gate = { state: onboarding.state, established, newArrival, machinesLoaded };
  useEffect(() => {
    if (shouldMarkOnboarded({ state: onboarding.state, established, newArrival, machinesLoaded })) {
      onboarding.complete();
    }
  }, [onboarding, machinesLoaded, established, newArrival]);
  // No setup pages any more (see the gate below): once steps 04 to 06 are over,
  // a new account is done. A returning account is marked by the effect above.
  useEffect(() => {
    if (afterSignInDone && shouldShowSetup({ state: onboarding.state, established, newArrival, machinesLoaded })) {
      onboarding.complete();
    }
  }, [afterSignInDone, onboarding, machinesLoaded, established, newArrival]);
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
  /*
   * The other half of the destination-less open. Same gate and same reason: a
   * widget tap on a cold start arrives before there is a Stack to pop within.
   */
  useRootOpenRouting(authStatus === "signed-in" && consent.state === "granted");
  /*
   * The third way in, and the one most likely to arrive on a cold start: a
   * Siri or Shortcuts phrase. Same gate, same reason. The scope must match the
   * one `app/session/new.tsx` looks the request up with, or the chat opens on
   * the "no longer available" page.
   */
  useAppIntentRouting(
    authStatus === "signed-in" && consent.state === "granted",
    client ?? null,
    `${user?.id}:${bindingId}`,
  );
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
      /*
       * And show the welcome flow again, because a signed-out device is a new
       * arrival by every test this app can apply. It also makes the flow
       * reviewable at all: the flag was written once and never cleared, so
       * after the first sign-in the only way back to it was a reinstall.
       *
       * AFTER `dismissTo`, deliberately. Resetting flips the signed-out branch
       * from the sign-in Stack to the flow, which is not a navigator; popping
       * has to happen while the stack it is popping is still mounted.
       */
      intro.reset();
    }
  }, [authStatus, intro]);
  const { colors, isDark } = useTheme();
  // See the note at the Settings family below.
  const groupedScreen = {
    headerStyle: { backgroundColor: colors.groupedBackground },
    contentStyle: { backgroundColor: colors.groupedBackground },
  } as const;
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

  /*
   * What a gate shows while it waits.
   *
   * The splash is right for a cold start: nothing is on screen yet. It is
   * wrong once somebody has just signed in, because then it lands in the
   * middle of onboarding. Benny's rule, 2026-09-24: no splash inside the
   * flow. So after a sign-in in this launch the short local waits (consent,
   * onboarding flag) hold a plain page in the flow's own colour, and the
   * long ones are not reached by a new account at all (see the gates).
   *
   * A ref written during render on purpose: the very first signed-in render
   * already needs the answer, and an effect would be one frame late.
   */
  const sawSignedOut = useRef(false);
  if (authStatus === "signed-out") sawSignedOut.current = true;
  const hold = sawSignedOut.current ? (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={isDark ? "light" : "dark"} />
    </View>
  ) : (
    <Splash />
  );

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
      /*
       * Welcome, and the sign-in drawer over it.
       *
       * INSIDE the signed-out branch, never as a gate over it. A gate above
       * this branch is the #237 splash deadlock -- a condition goes
       * permanently true and sign-in becomes unreachable with no way out but
       * reinstalling. Nested here, whatever the flow decides, this branch
       * still owns the signed-out tree.
       *
       * Apple and Google sign in inside the drawer, which replaces this whole
       * branch. Email completes the intro, which falls through to the sign-in
       * Stack below with its email field. `intro.complete` marks the welcome
       * as seen, so a failed attempt does not show it again.
       *
       * The questions that used to come BEFORE this now come after sign-in,
       * and only for a new account. See the questions gate further down.
       */
      return (
        <>
          <StatusBar style={isDark ? "light" : "dark"} />
          <WelcomeGate
            onEmail={intro.complete}
            onTerms={() => void Linking.openURL("https://omg.dev/terms")}
            onPrivacy={() => void Linking.openURL("https://omg.dev/privacy")}
          />
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
            <Stack.Screen name="archive" options={{ title: "Archive", headerLargeTitle: true }} />
            <Stack.Screen name="session/[id]" options={{ title: "Session" }} />
            <Stack.Screen name="session/new" options={{ headerShown: false }} />
            {/* THE SETTINGS FAMILY IS A GROUPED LIST, so it takes iOS's
                grouped background rather than the app's own `bg`.
                `contentStyle` and `headerStyle` have to move together: the
                large title sits in the header, and a header one shade off the
                page is visible as a seam the moment the list scrolls under it.
                These are the only screens that use `Card`, which is the other
                half of the pair (see `groupedCard` in palette.ts). */}
            <Stack.Screen name="computers" options={groupedScreen} />
            <Stack.Screen name="computer" options={{ title: "Computer" }} />
            <Stack.Screen name="settings" options={groupedScreen} />
            <Stack.Screen
              name="settings/coding-agents"
              options={{ ...groupedScreen, title: "Coding agents", headerLargeTitle: true }}
            />
            <Stack.Screen
              name="settings/connectors"
              options={{ ...groupedScreen, title: "Connectors", headerLargeTitle: true }}
            />
            <Stack.Screen name="settings/agent" options={{ ...groupedScreen, title: "" }} />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="schedules" options={groupedScreen} />
            <Stack.Screen name="plan" />
            <Stack.Screen name="bots/index" />
            <Stack.Screen name="bots/new" />
            <Stack.Screen name="bots/[id]/index" />
            <Stack.Screen name="bots/[id]/edit" />
            <Stack.Screen name="artifact/file" />
            <Stack.Screen name="artifact/html" />
            <Stack.Screen name="artifact/index" />
            <Stack.Screen name="auto/[agentId]" />
            <Stack.Screen name="auto/[agentId]/[findingId]" />
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
    return hold;
  }

  /*
   * Onboarding, below the signed-out branch.
   *
   * It is below signed-out for the reason spelled out above: any gate above
   * that branch can make sign-in unreachable, which is exactly the splash
   * deadlock #237 fixed. The data notice sits after the questions, before
   * anything can be sent; see the gate for it below.
   *
   * Like consent, this parks in "loading" until there is a user id, so it
   * cannot flash for the moment between signed-in and the account resolving.
   */
  if (onboarding.state === "loading") {
    return hold;
  }

  /*
   * Steps 02 and 03, the questions. Built once and returned by two gates: the
   * early one for a known new sign-up, and the fallback after the machines
   * load when the creation time is unknown. The same element in the same
   * position, so moving between the two cannot remount it and lose answers.
   */
  const questionsGate = (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <OnboardingFlow
        finalLabel="Start"
        initial={questionsChoice}
        onDone={(choice) => {
          setQuestionsChoice(choice);
          void stashOnboardingChoice(choice).finally(() => setQuestionsDone(true));
        }}
      />
    </>
  );

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

  /*
   * A new sign-up goes to the questions AT ONCE. The creation time already
   * says who they are, so there is no reason to hold them on the splash for
   * the computer list, which took about 24 s for a brand-new account in the
   * e2e run on 2026-09-24. The list keeps loading behind the questions.
   */
  if (onboarding.state === "needed" && newAccount === true && !questionsDone) {
    return questionsGate;
  }

  /*
   * THE DATA NOTICE, after the questions for a new sign-up (Benny,
   * 2026-09-24): asking about AI providers before somebody has even said what
   * they want read as a wall. Nothing above this line sends anything to an AI
   * provider -- the questions keep the prompt and any picked files on the
   * phone -- and everything below it can, so the guarantee Apple asked for
   * still holds: no transmission before an affirmative "Agree".
   *
   * Everyone else (a returning customer, an unknown account age) still meets
   * it first, exactly where it was.
   */
  if (consent.state === "needed") {
    return (
      <>
        <StatusBar style={isDark ? "light" : "dark"} />
        <AiConsentScreen
          onAccept={consent.accept}
          /*
           * A new sign-up who just wrote a prompt goes back to it (Benny,
           * 2026-09-24). Signing them out would throw away the thing they
           * came to do. Everyone else meets the notice with nothing written,
           * and declining still signs out, as it always has.
           */
          onDecline={
            onboarding.state === "needed" && newAccount === true && questionsDone
              ? () => setQuestionsDone(false)
              : handleDecline
          }
        />
      </>
    );
  }

  // A new sign-up never waits here: its questions came first, and step 04
  // below waits for the Computer on its own screen, not on a splash.
  if (onboarding.state === "needed" && newAccount !== true && !machinesLoaded && !machinesError) {
    return hold;
  }

  /*
   * Steps 02 and 03, the questions: interests, task, prompt.
   *
   * After sign-in since 2026-09-24 (Benny): sign-in moved up to right after
   * Welcome, so a returning customer never sees these. A known new sign-up
   * was already sent to them by the early gate above the machines splash.
   * This one covers an unknown creation time, where `established` decides
   * after the machines have loaded.
   *
   * The choice is stashed and AWAITED before this gate opens, because the
   * next gate reads the stash on its first render.
   */
  // Unknown creation time only: a new sign-up was sent here above already.
  if (onboarding.state === "needed" && !established && !questionsDone) {
    return questionsGate;
  }

  /*
   * Steps 04 to 06 of the revamp: the task they just wrote, now
   * running, then the real session, then the plan.
   *
   * ABOVE the setup gate on purpose. Benny's rule for the new flow is that
   * connecting agent subscriptions happens after the paywall -- once somebody
   * has seen their first session work, not before they have seen anything.
   *
   * Gated on `needed` so an established account never sees it, and on a local
   * done flag so leaving it is final for this launch. It cannot hang: the
   * component gives up on an unreachable Computer after LAUNCH_WAIT_MS and
   * calls onDone, which drops through to exactly the gates below.
   */
  if (onboarding.state === "needed" && !afterSignInDone) {
    const { agents } = rosterFromReadiness(readiness);
    return (
      <>
        <StatusBar style={isDark ? "light" : "dark"} />
        <OnboardingAfterSignIn
          client={client}
          ready={readiness?.status === "ready"}
          // No cwd. The box has a default working directory and a first-run
          // guess from this side would be worse than it.
          agent={agents.find((a) => a.connected)?.key ?? ""}
          runningCount={1}
          onNotify={() => {
            // Best effort. The permission prompt is the point; a failed token
            // registration must not hold up the flow, and Settings has the
            // repair path for it.
            if (client) void registerForPushNotifications(client.transport, user?.email).catch(() => {});
          }}
          onOpenSession={setPendingSession}
          onDone={endAfterSignIn}
          pendingTitle={questionsPrompt}
          splash={hold}
        />
      </>
    );
  }

  /*
   * THE CONNECT AND PLAN SETUP PAGES ARE OUT OF ONBOARDING (Benny,
   * 2026-09-24: "not needed now"). Onboarding ends when steps 04 to 06 end,
   * and the account is marked done here instead of by SetupScreen's last
   * button. Connecting an agent stays in Settings > Coding agents.
   *
   * `shouldShowSetup` still names who WOULD be owed the step, so it is the
   * condition for finishing: nobody reaches the app with the flag unwritten.
   * The plain page shows for the one render before the effect lands.
   */
  if (shouldShowSetup(gate)) {
    return hold;
  }


  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        key="signed-in"
        layout={IpadWorkspaceLayout}
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
          /**
           * No push/pop slide on iPad. The rail stays put and tapping a
           * session swaps the pane beside it, so a screen sliding in from the
           * right reads as the wrong thing moving. The phone keeps the
           * system transition.
           */
          animation: Platform.OS === "ios" && Platform.isPad ? "none" : "default",
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
          <Stack.Screen name="archive" options={{ title: "Archive", headerLargeTitle: true }} />
          <Stack.Screen
            name="session/[id]"
            options={({ route }) => ({
              title: "Session",
              // The first session after onboarding opens in place, not with a
              // slide over Home. See OpenWhenMounted.
              ...((route.params as { arrive?: string } | undefined)?.arrive === "instant" ? { animation: "none" as const } : {}),
            })}
          />
            <Stack.Screen name="session/new" options={{ headerShown: false }} />
          {/* Switching machines is the frequent action and belongs in the menu
              on the machine chip; pairing and per-machine detail still need a
              screen. See computer-picker.ts for why both exist. */}
          <Stack.Screen
            name="computers"
            options={{ title: "Computers", headerLargeTitle: true }}
          />
          <Stack.Screen name="computer" options={{ title: "Computer" }} />
          <Stack.Screen
            name="settings"
            options={{ title: "Settings", headerLargeTitle: true }}
          />
          {/* Connecting a coding agent, natively. Both screens live under
              app/settings/ and MUST be declared here as well as in the
              signed-out Stack above: a route that only appears there gets no
              options in the signed-in tree, and the native header falls back
              to printing the route name ("settings/coding-agents").
              settings/agent draws its own large title, so its header title
              stays empty. */}
          <Stack.Screen
            name="settings/coding-agents"
            options={{ title: "Coding agents", headerLargeTitle: true }}
          />
          <Stack.Screen
            name="settings/connectors"
            options={{ title: "Connectors", headerLargeTitle: true }}
          />
          <Stack.Screen name="settings/agent" options={{ title: "" }} />
          {/* Questions waiting on you, and what shipped. Pushed from the
              greeting, which is where the web puts the same door. */}
          <Stack.Screen
            name="notifications"
            options={{ title: "Notifications", headerLargeTitle: true }}
          />
          {/* The auto agent roster, the web's "Schedules" surface. Reached
              from the home header's pages menu. */}
          <Stack.Screen
            name="schedules"
            options={{ title: "Schedules", headerLargeTitle: true }}
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
          {/* Replay of the welcome flow, from Settings. The screens draw their
              own chrome (dots, Skip), so no system header. */}
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          {/* In-app purchase. Pushed from the blocked cloud computer and from
              Settings — the two places someone learns they need to pay. It is
              a normal pushed screen rather than a modal so the back gesture
              behaves the same as everywhere else. */}
          <Stack.Screen name="plan" options={{ title: "Subscription", headerLargeTitle: true }} />
          <Stack.Screen name="artifact/file" options={{ title: "File" }} />
          <Stack.Screen name="artifact/html" options={{ title: "Artifact" }} />
          <Stack.Screen name="artifact/index" options={{ title: "Artifacts" }} />
          <Stack.Screen name="auto/[agentId]" options={{ title: "Report" }} />
          <Stack.Screen name="auto/[agentId]/[findingId]" options={{ title: "Finding" }} />
        </Stack.Protected>
      </Stack>
      {pendingSession ? (
        <OpenWhenMounted sessionId={pendingSession} onOpened={clearPendingSession} />
      ) : null}
    </>
  );
}

export default function Layout() {
  // Fetch and apply a published update on launch and on return from a pause.
  useOtaUpdates();
  const { isDark } = useTheme();
  // Fold the persisted demo-mode override into the synchronous cache BEFORE the
  // provider mounts, so its first refreshSession/refreshMachines already knows
  // whether this is a demo session. The env flag resolves this instantly; a
  // stored toggle is one AsyncStorage read. See demo.ts.
  const [demoReady, setDemoReady] = useState(false);
  useEffect(() => {
    void loadDemoMode().finally(() => setDemoReady(true));
  }, []);
  if (!demoReady) return null;
  return (
    <OmgProvider>
      <AgentLiveActivityBridge />
      <AgentVillageWidgetBridge />
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
