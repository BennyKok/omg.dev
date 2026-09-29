/** Simulator-only visual proof for the live project preview card. */
import { registerRootComponent } from "expo";
import { SafeAreaView, ScrollView } from "react-native";
import type { OmgTransport } from "@omg-dev/client";
import type { ProjectPreviewSnapshot } from "../../packages/protocol/src/project-preview";
import type { ExpoAccountSnapshot } from "../../packages/protocol/src/expo-account";
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

const connectSnapshot: ProjectPreviewSnapshot = {
  preview: {
    ...snapshot.preview!,
    sessionId: "55555555-5555-4555-8555-555555555555",
    title: "My connect app",
    port: 8084,
    expoGoUrl: "exps://example.com",
  },
};

/** No account route: a Computer from before Connect Expo. */
function fixed(value: ProjectPreviewSnapshot): Pick<OmgTransport, "request"> {
  return {
    async request<T>(path: string): Promise<T> {
      if (path.startsWith("/api/expo-account")) throw new Error("404");
      return value as T;
    },
  };
}

/**
 * A Computer with the Expo account route. POST connect starts a "signup" or
 * "waiting" run and POST cancel ends it, as the server does.
 */
function withAccount(value: ProjectPreviewSnapshot, initial: ExpoAccountSnapshot): Pick<OmgTransport, "request"> {
  let account = initial;
  return {
    async request<T>(path: string, init?: { body?: unknown }): Promise<T> {
      if (path.startsWith("/api/expo-account/connect")) {
        const mode = typeof init?.body === "string" ? (JSON.parse(init.body) as { mode?: string }).mode : undefined;
        account = { signedIn: false, connect: { state: mode === "signup" ? "signup" : "waiting", startedAt: Date.now() } };
      } else if (path.startsWith("/api/expo-account/cancel")) {
        account = { signedIn: false, connect: { state: "cancelled", startedAt: account.connect?.startedAt ?? Date.now() } };
      } else if (path.startsWith("/api/computer/kiosk")) {
        // No Computer here: the sign-in sheet waits for Expo's page.
        return { open: false } as T;
      } else if (!path.startsWith("/api/expo-account")) {
        return value as T;
      }
      return account as T;
    },
  };
}

const transport = fixed(snapshot);
const expoTransport = withAccount(expoSnapshot, { signedIn: true, username: "expo-e2e-test" });
const connectTransport = withAccount(connectSnapshot, { signedIn: false });
const stoppedTransport = fixed(stoppedSnapshot);
// Its restart request fails, so the card returns to "Restart preview". An
// "Asked the agent to restart it" on screen can then only be the sleeping card.
const expiredTransport: Pick<OmgTransport, "request"> = {
  async request<T>(path: string): Promise<T> {
    if (path.includes("/send")) throw new Error("not in this test");
    return fixed(expiredSnapshot).request<T>(path);
  },
};

// The runner cannot scroll, so every card must fit on one screen: the short
// cards come first and the Expo cards, which open expanded, last. The web level has its own harness: project-preview-web-e2e-entry.tsx.
function App() {
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#141414" }}>
    <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
      <Text style={{ fontSize: 24, color: "#fff" }}>Project preview test</Text>
      <ProjectPreviewPanel sessionId="33333333-3333-4333-8333-333333333333" email="test@example.com" transport={stoppedTransport} />
      <ProjectPreviewPanel sessionId="44444444-4444-4444-8444-444444444444" email="test@example.com" transport={expiredTransport} />
      <ProjectPreviewPanel sessionId="11111111-1111-4111-8111-111111111111" email="test@example.com" transport={transport} />
      <ProjectPreviewPanel sessionId="55555555-5555-4555-8555-555555555555" email="test@example.com" transport={connectTransport} onOpenComputer={() => {}} initialLevel="device" />
      <ProjectPreviewPanel sessionId="22222222-2222-4222-8222-222222222222" email="test@example.com" transport={expoTransport} initialLevel="device" />
    </ScrollView>
  </SafeAreaView>;
}

registerRootComponent(App);
