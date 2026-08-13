import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { BrandMark } from "../src/omg/brand-mark";

import { OmgProvider, useOmg } from "../src/omg/provider";
import { useTheme } from "../src/omg/theme";

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
            <Stack.Screen name="index" options={{ headerShown: false }} />
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
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Protected guard={false}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard>
          {/* The sessions list draws its own top bar, because its composer is
              inside a KeyboardAvoidingView and KAV measures against its PARENT
              — a native header would need its height fed back as
              keyboardVerticalOffset. */}
          <Stack.Screen name="index" options={{ headerShown: false }} />
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
      <RootNavigator />
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
