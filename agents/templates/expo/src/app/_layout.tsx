import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "../lib/keyboard";

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="auto" />
    </KeyboardProvider>
  );
}
