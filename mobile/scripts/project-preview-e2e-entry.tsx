/** Simulator-only visual proof for the live project preview card. */
import { registerRootComponent } from "expo";
import { SafeAreaView, View } from "react-native";
import type { OmgTransport } from "@omg-dev/client";
import type { ProjectPreviewSnapshot } from "../../packages/protocol/src/project-preview";
import { ProjectPreviewPanel } from "../src/omg/project-preview-card";
import { Text } from "../src/omg/text";

const snapshot: ProjectPreviewSnapshot = {
  preview: {
    sessionId: "11111111-1111-4111-8111-111111111111",
    title: "My Expo app",
    url: "https://example.com",
    port: 5173,
    kind: "sandbox-preview",
    visibility: "owner",
    temporary: true,
    createdAt: Date.now(),
  },
};

const transport: Pick<OmgTransport, "request"> = {
  async request<T>(): Promise<T> { return snapshot as T; },
};

function App() {
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#141414" }}>
    <View style={{ padding: 24, gap: 24 }}>
      <Text style={{ fontSize: 24, color: "#fff" }}>Project preview test</Text>
      <ProjectPreviewPanel sessionId="11111111-1111-4111-8111-111111111111" email="test@example.com" transport={transport} />
    </View>
  </SafeAreaView>;
}

registerRootComponent(App);
