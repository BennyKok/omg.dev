/** Simulator-only entry point. Uses the production UI and native module with
 * a local fixture computer. Not the app's normal Expo Router entry point. */
import { registerRootComponent } from "expo";
import { SafeAreaView, View, Text } from "react-native";
import type { OmgTransport } from "@omg-dev/client";
import { BrowserLoginPanel } from "../src/omg/browser-login-card";

const transport: Pick<OmgTransport, "request"> = {
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`http://localhost:18767${path}`, init);
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return await res.json() as T;
  },
};
function App() {
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
    <View style={{ padding: 24, gap: 24 }}>
      <Text style={{ fontSize: 24, color: "#111" }}>Website login test</Text>
      <BrowserLoginPanel sessionId="11111111-1111-4111-8111-111111111111" email="test@example.com" transport={transport} />
    </View>
  </SafeAreaView>;
}
registerRootComponent(App);
