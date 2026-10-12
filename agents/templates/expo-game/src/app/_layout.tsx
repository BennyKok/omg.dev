import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "../lib/keyboard";

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <Stack screenOptions={{ headerShown: false, animation: "none", contentStyle: { backgroundColor: "#12172b" } }} />
      <StatusBar style="light" />
    </KeyboardProvider>
  );
}
