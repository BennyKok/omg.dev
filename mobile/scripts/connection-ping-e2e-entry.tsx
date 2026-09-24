/** Simulator-only Settings component proof against the real regional gateway. */
import { registerRootComponent } from "expo";
import { SafeAreaView, Text } from "react-native";
import { createGrantTransport } from "@omg-dev/client";
import { Card } from "../src/components";
import { ConnectionPingRow } from "../src/omg/connection-ping-row";
const transport = createGrantTransport({
  baseUrl: "https://sessions.omgs.app",
  getGrant: async () => ({ token: process.env.EXPO_PUBLIC_OMG_TEST_GRANT ?? "", expiresAt: Date.now() + 60_000, sessionOrigin: "https://sessions-ca.omgs.app" }),
});
function App() {
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#111", padding: 20 }}>
    <Text style={{ fontSize: 30, color: "white", margin: 20 }}>Settings</Text>
    <Card><ConnectionPingRow transport={transport} active /></Card>
  </SafeAreaView>;
}
registerRootComponent(App);
