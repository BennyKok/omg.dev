/** Simulator-only proof of Boxy, the launch screen, and every connection overlay state. */
import { registerRootComponent } from "expo";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ConnectionSurface } from "../src/omg/connection-overlay";
import type { NativeOverlayView } from "../src/omg/connection-overlay-state";
import { LaunchScreen } from "../src/omg/launch";

type Stage = { name: string; view?: NativeOverlayView; launch?: boolean };
const card = (v: Omit<NativeOverlayView, "mode" | "nextChangeMs">): NativeOverlayView => ({ ...v, mode: "overlay", nextChangeMs: null });
const STAGES: Stage[] = [
  { name: "Launch", launch: true },
  { name: "Live" },
  {
    name: "Pill",
    view: { mode: "pill", mood: "searching", title: "Reconnecting…", detail: null, canSwitch: true, nextChangeMs: null },
  },
  { name: "Offline", view: card({ mood: "sleeping", title: "Connection unavailable", detail: "Check your connection, or choose another computer.", canSwitch: true }) },
  { name: "Paused", view: card({ mood: "sleeping", title: "Computer paused", detail: "This computer is paused. Resume it, or choose another computer.", canSwitch: true }) },
  { name: "Error", view: card({ mood: "error", title: "Your computer isn't responding", detail: "Try again, or choose another computer.", canSwitch: true }) },
  { name: "Waking", view: card({ mood: "booting", title: "Waking your computer…", detail: "This can take a moment.", canSwitch: true }) },
  { name: "Back", view: card({ mood: "happy", title: "Connected", detail: null, canSwitch: false }) },
];
const ROWS = ["Ads report status and conversions", "Identifying bot session activity", "Top up user credits system", "Why omgs.app blocked the preview", "Threads viral ideas", "Superschool onboarding"];

function App() {
  const [index, setIndex] = useState(0);
  const [taps, setTaps] = useState("");
  const stage = STAGES[index]!;
  // The launch screen takes every touch, as it does in the app, so it moves on by itself.
  useEffect(() => {
    if (!stage.launch) return;
    const timer = setTimeout(() => setIndex(1), 3500);
    return () => clearTimeout(timer);
  }, [stage.launch]);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Stage: {stage.name}</Text>
          <Pressable accessibilityRole="button" testID="next-stage" onPress={() => setIndex((i) => (i + 1) % STAGES.length)} style={styles.next}>
            <Text style={styles.nextText}>Next stage</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }}>
          {ROWS.map((row) => (
            <View key={row}>
              <Text style={styles.row}>{row}</Text>
              <Text style={styles.sub}>Sounds good. When you're back, I will continue.</Text>
            </View>
          ))}
          <Text style={styles.sub}>{taps}</Text>
        </ScrollView>
        {stage.view ? (
          <ConnectionSurface
            view={stage.view}
            onRetry={stage.view.mood === "happy" ? undefined : () => setTaps("Retry tapped")}
            onChooseAnother={() => setTaps("Choose another tapped")}
          />
        ) : null}
        {stage.view ? (
          // Harness control only: above the card, which blocks touches behind it.
          <Pressable accessibilityRole="button" onPress={() => setIndex((i) => (i + 1) % STAGES.length)} style={styles.float}>
            <Text style={styles.nextText}>Next stage</Text>
          </Pressable>
        ) : null}
        {stage.launch ? <LaunchScreen label="Connecting" /> : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#141414" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  title: { color: "#F2F2ED", fontSize: 17, fontWeight: "600" },
  next: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: "#2c2c2e" },
  nextText: { color: "#F2F2ED", fontSize: 15 },
  float: { position: "absolute", bottom: 24, left: 24, right: 24, height: 64, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: "#3a3a3c" },
  row: { color: "#F2F2ED", fontSize: 17, fontWeight: "600" },
  sub: { color: "rgba(235,230,220,0.6)", fontSize: 14 },
});
registerRootComponent(App);
