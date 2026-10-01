/** Simulator-only visual proof for level 1: a new Expo app opens on Web. */
import { registerRootComponent } from "expo";
import { SafeAreaView, ScrollView } from "react-native";
import type { OmgTransport } from "@omg-dev/client";
import type { ExpoAccountSnapshot } from "../../packages/protocol/src/expo-account";
import type { ProjectPreviewSnapshot } from "../../packages/protocol/src/project-preview";
import { ProjectPreviewPanel } from "../src/omg/project-preview-card";
import { Text } from "../src/omg/text";

const snapshot: ProjectPreviewSnapshot = {
  live: true,
  preview: {
    sessionId: "66666666-6666-4666-8666-666666666666",
    title: "My web level app",
    url: "https://example.com",
    port: 8081,
    kind: "sandbox-preview",
    visibility: "owner",
    temporary: true,
    createdAt: Date.now(),
    // The inline frame loads the https form of this host.
    expoGoUrl: "exps://example.com",
  },
};
const account: ExpoAccountSnapshot = { signedIn: true, username: "expo-e2e-test" };
const ownerSnapshot: ProjectPreviewSnapshot = {
  ...snapshot,
  preview: {
    ...snapshot.preview!,
    title: "Owner auth preview",
    appId: "owner-auth-preview",
    projectId: "owner-auth-project",
    expoGoUrl: "exps://1d38d53e4d93-8081-1799999999-abcdef.preview.omgs.app",
  },
};

const transport: Pick<OmgTransport, "request"> = {
  async request<T>(path: string): Promise<T> {
    return (path.startsWith("/api/expo-account") ? account : snapshot) as T;
  },
};

function App() {
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#141414" }}>
    <ScrollView contentContainerStyle={{ padding: 24, gap: 24 }}>
      <Text style={{ fontSize: 24, color: "#fff" }}>Web level test</Text>
      <ProjectPreviewPanel sessionId="66666666-6666-4666-8666-666666666666" email="test@example.com" transport={transport} />
      <ProjectPreviewPanel sessionId="77777777-7777-4777-8777-777777777777" transport={{
        async request<T>(path: string): Promise<T> { return (path.startsWith("/api/expo-account") ? account : ownerSnapshot) as T; },
      }} />
    </ScrollView>
  </SafeAreaView>;
}

registerRootComponent(App);
