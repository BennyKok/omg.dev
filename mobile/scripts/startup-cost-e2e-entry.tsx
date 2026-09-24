/** Real-network comparison of full bootstrap/close refresh against the optimized path. */
import { registerRootComponent } from "expo";
import { useEffect, useState } from "react";
import { SafeAreaView, ScrollView, Text } from "react-native";
import { createGrantTransport } from "@omg-dev/client";
import { requestSessionGrant } from "../src/omg/transport";
import { createGrantOwner } from "../src/omg/grant-owner";
import { probeReadiness } from "../src/omg/readiness";
import { connectionTimings, tracedFetch, traceConnectionTransport } from "../src/omg/connection-trace";
import { ConnectionTimingsRow } from "../src/omg/connection-timings-row";

async function run(optimized: boolean) {
  const binding = process.env.EXPO_PUBLIC_OMG_TEST_BINDING;
  const auth = process.env.EXPO_PUBLIC_OMG_TEST_AUTH;
  if (!binding || !auth) throw Error("Authorized test credentials required");
  let grants = 0;
  const owner = createGrantOwner(() => { grants++; return requestSessionGrant(binding, auth); });
  const transport = traceConnectionTransport(createGrantTransport({ baseUrl: "https://sessions.omgs.app", getGrant: owner.get, fetch: tracedFetch }));
  let close = () => {};
  const cycle = async () => {
    const started = performance.now();
    const live = (async () => {
      const socket = await transport.openLiveSocket();
      close = () => socket.close(optimized ? 1000 : 4000, "benchmark transition");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error("Live timeout")), 20000);
        socket.addEventListener("open", () => socket.send(JSON.stringify({ t: "subscribe", channels: [{ kind: "status", key: "*" }] })));
        socket.addEventListener("error", () => { clearTimeout(timeout); reject(Error("Socket error")); });
        socket.addEventListener("message", (event: any) => {
          const message = JSON.parse(String(event.data));
          if (message.t === "ping") socket.send(JSON.stringify({ t: "pong" }));
          if (message.t === "snapshot" || message.t === "status") { clearTimeout(timeout); resolve(); }
        });
      });
    })();
    const observed = live.then(() => ({}), error => ({ error }));
    const readiness = await probeReadiness({ ...transport, fetch: (path, init) => transport.fetch(optimized ? path : path.split("?")[0]!, init) });
    if (readiness.status !== "ready") throw Error(`Computer ${readiness.status}`);
    const readyMs = Math.round(performance.now() - started);
    const size = connectionTimings().filter(t => t.stage === "bootstrap.size").at(-1)?.size ?? 0;
    await transport.request("/api/sessions");
    const result = await observed;
    if ("error" in result) throw result.error;
    const usableMs = Math.round(performance.now() - started);
    close();
    return { readyMs, usableMs, size };
  };
  try {
    const cold = await cycle();
    // Let the native close event arrive, as it would between two screen visits.
    await new Promise(resolve => setTimeout(resolve, 300));
    const before = grants;
    const warm = await cycle();
    const refreshes = grants - before;
    if (optimized && refreshes !== 0) throw Error(`Unexpected grant refresh: ${refreshes}`);
    return { cold, warm, refreshes };
  } finally { close(); }
}
function App() {
  const [lines, setLines] = useState(["Startup cost comparison", "Live relay. Existing account token. Full screen paint excluded."]);
  useEffect(() => {
    let active = true;
    const add = (text: string) => { if (active) setLines(old => [...old, text]); };
    void (async () => {
      for (let i = 0; i < 3; i++) {
        for (const optimized of i % 2 ? [true, false] : [false, true]) {
          const r = await run(optimized);
          add(`${optimized ? "Optimized" : "Previous"} ${i + 1}: payload ${r.cold.size} chars; ready ${r.cold.readyMs} ms; cold ${r.cold.usableMs} ms; return ${r.warm.usableMs} ms; refreshes ${r.refreshes}`);
        }
      }
      add("Startup cost comparison passed");
    })().catch(error => add(`FAILED: ${error.message}`));
    return () => { active = false; };
  }, []);
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#111" }}><ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
    {lines.map(line => <Text key={line} style={{ color: "white", fontSize: 14 }}>{line}</Text>)}
    <ConnectionTimingsRow active />
  </ScrollView></SafeAreaView>;
}
registerRootComponent(App);
