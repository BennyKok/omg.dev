/** Simulator-only proof of Boxy, the launch screen, and every connection overlay state. */
import { registerRootComponent } from "expo";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ConnectionActions } from "../src/omg/connection-overlay";
import { nativeOverlayView, type NativeOverlayInput, type NativeOverlayView } from "../src/omg/connection-overlay-state";
import { LaunchScreen } from "../src/omg/launch";

type Stage = { name: string; view?: NativeOverlayView; launch?: boolean };
// Every stage comes from the real rules, so the buttons shown are the app's.
const LIVE: NativeOverlayInput = { selected: true, everReady: true, hasSaved: false, readiness: "ready", socket: "live", cloudPaused: false, notLiveMs: 0, suppressed: false };
const rule = (v: Partial<NativeOverlayInput>) => nativeOverlayView({ ...LIVE, ...v });
const FIRST = { everReady: false, readiness: "connecting", socket: "connecting" } as const;
const STAGES: Stage[] = [
  { name: "Launch", launch: true },
  { name: "Live" },
  { name: "Brief drop", view: rule({ socket: "reconnecting", notLiveMs: 3_000 }) },
  { name: "Long drop", view: rule({ socket: "reconnecting", notLiveMs: 12_000 }) },
  { name: "First connect", view: rule({ ...FIRST, notLiveMs: 1_000 }) },
  { name: "Paused", view: rule({ ...FIRST, cloudPaused: true, notLiveMs: 1_000 }) },
  { name: "Long wait", view: rule({ ...FIRST, readiness: "waking", notLiveMs: 25_000 }) },
  { name: "Give up", view: rule({ ...FIRST, notLiveMs: 61_000 }) },
  { name: "Error", view: rule({ readiness: "unavailable", socket: "offline", notLiveMs: 20_000 }) },
  { name: "Offline", view: rule({ socket: "offline", notLiveMs: 20_000 }) },
  { name: "Recovered", view: rule({ readiness: "unavailable", socket: "live", notLiveMs: 40_000 }) },
];
const ROWS = ["Ads report status and conversions", "Identifying bot session activity", "Top up user credits system", "Why omgs.app blocked the preview", "Threads viral ideas", "Superschool onboarding"];

function App() {
  const [index, setIndex] = useState(0);
  const [taps, setTaps] = useState("");
  const stage = STAGES[index]!;
  // The launch screen takes every touch, so its own Next stage button sits
  // above it. A busy simulator can take minutes for one look, so nothing in
  // this harness moves on by itself.
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Stage: {stage.name}</Text>
          {/* Covered pages carry their own Next stage above them; one button at a time. */}
          {stage.view?.mode === "page" || stage.launch ? null : (
            <Pressable accessibilityRole="button" testID="next-stage" onPress={() => setIndex((i) => (i + 1) % STAGES.length)} style={styles.next}>
              <Text style={styles.nextText}>Next stage</Text>
            </Pressable>
          )}
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
        {/* The page is composed exactly as ConnectionPage composes it, with the
            harness's Next stage in the same actions area as Try again: the
            page takes every touch, and this proves its buttons receive them. */}
        {stage.launch || stage.view?.mode === "page" ? (
          <LaunchScreen
            key={stage.name}
            label={stage.view?.title ?? "Connecting to your computer"}
            detail={stage.view?.detail}
            mood={stage.view?.mood ?? "booting"}
            actions={
              <>
                {stage.view ? (
                  <ConnectionActions
                    view={stage.view}
                    onRetry={() => setTaps("Retry tapped")}
                    onChooseAnother={() => setTaps("Choose another tapped")}
                  />
                ) : null}
                <Pressable accessibilityRole="button" onPress={() => setIndex((i) => (i + 1) % STAGES.length)} style={styles.float}>
                  <Text style={styles.nextText}>Next stage</Text>
                </Pressable>
              </>
            }
          />
        ) : null}
        {/* Above the opaque page, so a tap on its buttons is visible. */}
        {taps && stage.view ? <Text style={styles.tapped}>{taps}</Text> : null}
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
  float: { height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "#3a3a3c" },
  row: { color: "#F2F2ED", fontSize: 17, fontWeight: "600" },
  tapped: { position: "absolute", top: 64, left: 0, right: 0, textAlign: "center", color: "#F2F2ED", fontSize: 15 },
  sub: { color: "rgba(235,230,220,0.6)", fontSize: 14 },
});
registerRootComponent(App);
