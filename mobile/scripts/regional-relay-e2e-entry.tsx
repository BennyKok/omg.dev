/** Simulator-only live transport proof. Supply a short-lived session grant at build time.
 * Never include account/Bridge credentials. Production uses expo-router/entry.
 */
import { registerRootComponent } from "expo";
import { useEffect, useState } from "react";
import { SafeAreaView, Text } from "react-native";
import { createGrantTransport } from "@omg-dev/client";
import { computerSocketUrl } from "../src/omg/computer-socket";
import { signedArtifactUrl } from "../src/omg/signed-asset-url";

function App() {
  const [lines, setLines] = useState(["Regional relay verification"]);
  useEffect(() => {
    let stopped = false;
    let close = () => {};
    const add = (line: string) => { if (!stopped) setLines(previous => [...previous, line]); };
    void (async () => {
      const token = process.env.EXPO_PUBLIC_OMG_TEST_GRANT;
      if (!token) throw new Error("A short-lived test grant is required");
      const origin = "https://sessions-ca.omgs.app";
      const transport = createGrantTransport({
        baseUrl: "https://sessions.omgs.app",
        getGrant: async () => ({ token, expiresAt: Date.now() + 60_000, sessionOrigin: origin }),
      });
      const httpStarted = performance.now();
      const response = await transport.fetch("/api/sessions?limit=1");
      if (!response.ok) throw new Error(`Regional HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.sessions)) throw new Error("Missing real session list");
      add("Canada HTTP passed");
      add(`HTTP response: ${Math.round(performance.now() - httpStarted)} ms`);
      if (computerSocketUrl(origin) !== "wss://sessions-ca.omgs.app/api/computer") throw new Error("Wrong computer socket origin");
      if (new URL(signedArtifactUrl(origin, "/api/artifacts/test", token)).origin !== origin) throw new Error("Wrong artifact origin");
      add("Computer and artifact routes passed");
      const socket = await transport.openLiveSocket();
      close = () => socket.close();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Regional socket timed out")), 15_000);
        let pingStarted = 0;
        socket.addEventListener("open", () => { pingStarted = performance.now(); socket.send(JSON.stringify({ t: "ping", id: "native-regional-proof" })); });
        socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Regional socket failed")); });
        socket.addEventListener("message", (event: any) => {
          const message = JSON.parse(String(event.data));
          if (message.t === "ping") socket.send(JSON.stringify({ t: "pong" }));
          if (message.t === "pong" && message.id === "native-regional-proof") { clearTimeout(timeout); add(`Live round trip: ${Math.round(performance.now() - pingStarted)} ms`); resolve(); }
        });
      });
      add("Canada WebSocket passed");
      close();
      add("Live regional transport passed");
    })().catch(error => add(`FAILED: ${error.message}`));
    return () => { stopped = true; close(); };
  }, []);
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#111", padding: 28 }}>
    {lines.map(line => <Text key={line} style={{ color: "white", fontSize: 22, margin: 12 }}>{line}</Text>)}
  </SafeAreaView>;
}
registerRootComponent(App);
