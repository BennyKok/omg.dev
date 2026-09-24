/** Simulator-only visual proof for the live project preview card. */
import { registerRootComponent } from "expo";
import { SafeAreaView, ScrollView } from "react-native";
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

const expoSnapshot: ProjectPreviewSnapshot = {
  preview: {
    ...snapshot.preview!,
    sessionId: "22222222-2222-4222-8222-222222222222",
    title: "My todo app",
    port: 8081,
    expoGoUrl: "exps://example.com",
  },
};

const stoppedSnapshot: ProjectPreviewSnapshot = {
  live: false,
  preview: {
    ...snapshot.preview!,
    sessionId: "33333333-3333-4333-8333-333333333333",
    title: "My sleeping app",
    port: 8082,
    expoGoUrl: "exps://example.com",
  },
};

const expiredSnapshot: ProjectPreviewSnapshot = {
  live: false,
  expired: true,
  preview: {
    ...snapshot.preview!,
    sessionId: "44444444-4444-4444-8444-444444444444",
    title: "My old app",
    port: 8083,
    expoGoUrl: "exps://example.com",
  },
};

function fixed(value: ProjectPreviewSnapshot): Pick<OmgTransport, "request"> {
  return { async request<T>(): Promise<T> { return value as T; } };
}

const transport = fixed(snapshot);
const expoTransport = fixed(expoSnapshot);
const stoppedTransport = fixed(stoppedSnapshot);
const expiredTransport = fixed(expiredSnapshot);

function App() {
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#141414" }}>
    <ScrollView contentContainerStyle={{ padding: 24, gap: 24 }}>
      <Text style={{ fontSize: 24, color: "#fff" }}>Project preview test</Text>
      <ProjectPreviewPanel sessionId="11111111-1111-4111-8111-111111111111" email="test@example.com" transport={transport} />
      <ProjectPreviewPanel sessionId="44444444-4444-4444-8444-444444444444" email="test@example.com" transport={expiredTransport} />
      <ProjectPreviewPanel sessionId="22222222-2222-4222-8222-222222222222" email="test@example.com" transport={expoTransport} />
      <ProjectPreviewPanel sessionId="33333333-3333-4333-8333-333333333333" email="test@example.com" transport={stoppedTransport} />
    </ScrollView>
  </SafeAreaView>;
}

registerRootComponent(App);
