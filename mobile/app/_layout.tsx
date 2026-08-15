import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { BrandMark } from "../src/omg/brand-mark";
import { LaunchScreen } from "../src/omg/launch";
import { useLucideFont } from "../src/omg/lucide";

import { OmgProvider, useOmg } from "../src/omg/provider";
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

  const settling =
    !expired &&
    authStatus === "signed-in" &&
    (!machinesLoaded ||
      (!!bindingId &&
        (readiness === null ||
          readiness.status === "connecting" ||
          readiness.status === "waking")));

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
  const { authStatus } = useOmg();
  const { colors, isDark } = useTheme();
  // Shares the splash with auth, rather than flashing an icon-less bar for a
  // frame: the font resolves from a bundled asset, so this is never a wait
  // the user can perceive on a warm start.
  const glyphsReady = useLucideFont();

  if (authStatus === "loading" || !glyphsReady) {
    return <Splash />;
  }

  if (authStatus === "signed-out") {
    return (
      <>
        <StatusBar style={isDark ? "light" : "dark"} />
        <Stack screenOptions={{ contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Protected guard>
            <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={false}>
            <Stack.Screen name="index" options={{ title: "Sessions" }} />
            <Stack.Screen name="session/[id]" options={{ title: "Session" }} />
          </Stack.Protected>
        </Stack>
      </>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
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
