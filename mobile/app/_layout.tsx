import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { BrandMark } from "../src/omg/brand-mark";

import { OmgProvider, useOmg } from "../src/omg/provider";
import { useTheme } from "../src/omg/theme";
import { ToastProvider } from "../src/omg/toast";

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
          headerTransparent: true,
          headerBlurEffect: isDark ? "systemChromeMaterialDark" : "systemChromeMaterialLight",
          headerTintColor: colors.text,
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
    </>
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
