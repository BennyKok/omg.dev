import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";

import { BrandMark } from "../src/omg/brand-mark";

import { OmgProvider, useOmg } from "../src/omg/provider";
import { useTheme } from "../src/omg/theme";
import { ToastProvider } from "../src/omg/toast";

/**
 * Only iOS has the system chrome material AND the scroll-view inset behaviour
 * that a translucent bar depends on. See the note on `headerTransparent`.
 */
const translucentBar = Platform.OS === "ios";

function RootNavigator() {
  const { authStatus } = useOmg();
  const { colors, isDark } = useTheme();

  if (authStatus === "loading") {
    return (
      <View style={[styles.splash, { backgroundColor: colors.bg }]}>
        <BrandMark />
        <ActivityIndicator color={colors.textMuted} style={styles.splashSpinner} />
        <StatusBar style={isDark ? "light" : "dark"} />
      </View>
    );
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
    /**
     * The ONE place the page colour is painted, now that every screen's own
     * content view is transparent so the nav bar's blur has something to
     * sample. Behind the navigator rather than on each screen: one fill, so
     * there is nothing to disagree with mid-transition, and nothing opaque
     * between the scrolling content and the bar.
     */
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          /**
           * The nav bar is handed back to UIKit instead of being painted.
           *
           * `headerStyle: { backgroundColor: colors.bg }` forced it opaque,
           * which flattens the one piece of chrome iOS is most opinionated
           * about: a real UINavigationBar is translucent, samples what scrolls
           * under it, and grows a hairline only once content is behind it.
           *
           * BOTH halves below are load-bearing, and each was wrong alone.
           * RNSScreenStackHeaderConfig.mm maps the two props separately:
           * `headerTransparent` sets `edgesForExtendedLayout = UIRectEdgeAll`,
           * so the screen's content view extends UNDER the bar; only
           * `headerStyle.backgroundColor` with alpha 0 reaches
           * `configureWithTransparentBackground`, and only then does
           * `appearance.backgroundEffect` (the blur) actually show, because an
           * opaque background paints over it.
           *
           * `headerTransparent` alone therefore left the appearance opaque and
           * laid the black page on top of the large title — which is why the
           * home screen showed a tall empty band and no "Sessions" anywhere.
           * A transparent `headerStyle` alone left the layout un-extended, so
           * the blur had nothing behind it and resolved to a flat grey slab.
           *
           * The screens under this set `contentInsetAdjustmentBehavior` to
           * "automatic", which is what keeps their content STARTING below the
           * bar while still passing under it on scroll.
           *
           * ANDROID KEEPS AN OPAQUE BAR. `headerBlurEffect` is iOS-only, and
           * `contentInsetAdjustmentBehavior` is a UIScrollView property with
           * no Android equivalent — so a transparent bar there would be
           * absolutely positioned over content that nothing insets, putting
           * the first row under the title with no way to scroll it clear.
           * There is no system material to ask for, so the page colour is the
           * honest answer.
           */
          headerTransparent: translucentBar,
          headerStyle: { backgroundColor: translucentBar ? "transparent" : colors.bg },
          headerBlurEffect: isDark ? "systemChromeMaterialDark" : "systemChromeMaterialLight",
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
          /**
           * The screen background is TRANSPARENT, and the page colour is
           * painted once behind the whole navigator instead (see the wrapper
           * View in RootNavigator).
           *
           * This is the other half of the translucent bar. With
           * `headerTransparent` the screen's content view extends under the
           * bar — so if that view has an opaque background, it paints black
           * over the large title and the blur has a solid sheet pressed
           * against it. That is exactly what hid "Sessions": the title was
           * rendering the whole time, underneath this fill.
           *
           * Painting behind the navigator instead means there is still exactly
           * one place a background is drawn (no double-layering, no seam
           * mid-transition) and the bar has real content to sample.
           */
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Protected guard={false}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard>
          {/* Both this and session/[id] set the rest of their header options
              from inside the screen, because the items on the right need screen
              state (the machine chip here, the session overflow there). */}
          <Stack.Screen name="index" options={{ title: "Sessions" }} />
          <Stack.Screen name="session/[id]" options={{ title: "Session" }} />
          {/* Switching machines is the frequent action and belongs in the
              action sheet; pairing and per-machine detail still need a screen.
              See computer-picker.ts for why both exist. */}
          <Stack.Screen
            name="computers"
            options={{ title: "Computers", headerLargeTitle: true }}
          />
          <Stack.Screen
            name="settings"
            options={{ title: "Settings", headerLargeTitle: true }}
          />
        </Stack.Protected>
      </Stack>
    </View>
  );
}

export default function Layout() {
  return (
    <OmgProvider>
      {/* Above RootNavigator so the banner overlays every screen's header and
          content instead of being clipped by whichever Stack.Screen owns the
          view underneath it. */}
      <ToastProvider>
        <RootNavigator />
      </ToastProvider>
    </OmgProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  splashSpinner: {
    marginTop: 24,
  },
});
