/** Simulator-only visual regression fixture for out-of-order login rows. */
import { registerRootComponent } from "expo";
import { SafeAreaView, View, Text } from "react-native";
import type { OmgTransport } from "@omg-dev/client";
import type { BrowserLoginSnapshot } from "../../packages/protocol/src/browser-login";
import { BrowserLoginPanel } from "../src/omg/browser-login-card";

const snapshot: BrowserLoginSnapshot = {
  iosAvailable: true,
  desktopAvailable: true,
  requests: [
    {
      id: "new-request",
      sessionId: "11111111-1111-4111-8111-111111111111",
      url: "https://example.com/login",
      origin: "https://example.com",
      computerName: "Test Computer",
      reason: "Current login request",
      status: "pending",
      createdAt: 20,
      expiresAt: Date.now() + 600_000,
    },
    {
      id: "old-request",
      sessionId: "11111111-1111-4111-8111-111111111111",
      url: "https://example.com/login",
      origin: "https://example.com",
      computerName: "Test Computer",
      reason: "Old login request",
      status: "failed",
      createdAt: 10,
      expiresAt: Date.now() + 600_000,
      message: "Could not transfer the login.",
    },
  ],
};

const transport: Pick<OmgTransport, "request"> = {
  async request<T>(path: string): Promise<T> {
    if (path.startsWith("/api/browser-login/clients")) return { ok: true } as T;
    return snapshot as T;
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
