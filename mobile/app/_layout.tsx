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
          headerTransparent: true,
          // No headerBlurEffect. iOS 26 draws its own scroll edge effect on the
          // bar, and RNScreens warns outright that setting both "may cause
          // overlapping effects" — two materials stacked on one bar. The system
          // one is the more native of the two and adapts to appearance without
          // being told, which is the whole point of handing this to UIKit.
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
          {/* Without an explicit title the native bar falls back to the ROUTE
              name and reads "computers", lowercase, in a system font that
              nothing else in iOS lowercases. The large title is the system one
              rather than a heading drawn in the scroll view. */}
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
