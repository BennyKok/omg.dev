import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "../lib/keyboard";
import { OverlayProvider } from "../kit/overlay";

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <OverlayProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </OverlayProvider>
      <StatusBar style="auto" />
    </KeyboardProvider>
  );
}
