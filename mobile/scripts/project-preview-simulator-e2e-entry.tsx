/** Real WebView proof: status tokens change without replacing the loaded document. */
import { useEffect, useState } from "react";
import { registerRootComponent } from "expo";
import { Pressable, SafeAreaView, ScrollView } from "react-native";
import type { OmgTransport } from "@omg-dev/client";
import { ProjectPreviewPanel } from "../src/omg/project-preview-card";
import { Text } from "../src/omg/text";

const base = "http://localhost:18491";
const sessionId = "88888888-8888-4888-8888-888888888888";
const transport: Pick<OmgTransport, "request"> = {
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (path.startsWith("/api/expo-account")) return { signedIn: true, username: "expo-e2e-test" } as T;
    const endpoint = path.startsWith("/api/project-preview/simulator") ? "/action" : "/snapshot";
    const response = await fetch(`${base}${endpoint}`, init);
    if (!response.ok) throw new Error(`Fixture returned ${response.status}`);
    return response.json() as Promise<T>;
  },
};

type Checks = { loads: Record<string, number>; taps: Record<string, number>; polls: number; stream: string; released: boolean };
function App() {
  const [checks, setChecks] = useState<Checks | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      const next = await fetch(`${base}/checks`).then(r => r.json()).catch(() => null);
      if (live && next) setChecks(next);
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1_000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  const renewalPassed = (checks?.polls ?? 0) >= 4 && checks?.loads.A === 1 && checks?.taps.A === 1;
  const replacementPassed = checks?.stream === "B" && checks?.loads.B === 1;
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#141414" }}>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 24, color: "#fff" }}>Simulator preview test</Text>
      <Text style={{ color: "#fff" }}>{renewalPassed ? "Token renewal passed" : "Checking token renewal"}</Text>
      <Text style={{ color: "#fff" }}>{replacementPassed ? "New stream passed" : "Checking stream replacement"}</Text>
      {checks?.released ? <Text style={{ color: "#fff" }}>Simulator released</Text> : null}
      <Pressable accessibilityRole="button" testID="simulator-new-stream" onPress={() => void fetch(`${base}/replace`, { method: "POST" })}
        style={{ minHeight: 44, borderRadius: 12, backgroundColor: "#333", justifyContent: "center", alignItems: "center" }}>
        <Text style={{ color: "#fff" }}>Replace simulator stream</Text>
      </Pressable>
      <ProjectPreviewPanel sessionId={sessionId} email="test@example.com" transport={transport} initialLevel="simulator" />
    </ScrollView>
  </SafeAreaView>;
}

registerRootComponent(App);
