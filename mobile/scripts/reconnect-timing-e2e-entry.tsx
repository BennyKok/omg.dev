/** Live simulator benchmark. Baseline reproduces the previous serialized startup and grant owner. */
import { registerRootComponent } from "expo";
import { useEffect, useState } from "react";
import { ScrollView, SafeAreaView, Text } from "react-native";
import { createGrantTransport, type OmgGrant } from "@omg-dev/client";
import { requestSessionGrant } from "../src/omg/transport";
import { createGrantOwner } from "../src/omg/grant-owner";
import { probeReadiness, sharedReadiness } from "../src/omg/readiness";
import { tracedFetch, traceConnectionTransport, recordConnectionTiming } from "../src/omg/connection-trace";
import { ConnectionTimingsRow } from "../src/omg/connection-timings-row";

function previousOwner(mint: () => Promise<OmgGrant>) {
  let cached: OmgGrant | null = null, pending: Promise<OmgGrant> | null = null;
  return { async get({ forceRefresh }: { forceRefresh: boolean }) {
    if (!forceRefresh && cached && cached.expiresAt - Date.now() > 30_000) return cached;
    if (!forceRefresh && pending) return pending;
    pending = mint().then(g => { cached = g; return g; }).finally(() => { pending = null; });
    return pending;
  } };
}
async function run(optimized: boolean) {
  const binding = process.env.EXPO_PUBLIC_OMG_TEST_BINDING;
  const auth = process.env.EXPO_PUBLIC_OMG_TEST_AUTH;
  if (!binding || !auth) throw Error("Short-lived authorized test credentials required");
  let grants = 0;
  const mint = () => { grants++; return requestSessionGrant(binding, auth); };
  const owner = optimized ? createGrantOwner(mint) : previousOwner(mint);
  const transport = traceConnectionTransport(createGrantTransport({ baseUrl: "https://sessions.omgs.app", getGrant: owner.get, fetch: tracedFetch }));
  const start = performance.now();
  let close = () => {};
  const live = async () => {
    const socket = await transport.openLiveSocket();
    close = () => socket.close();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("Live data timeout")), 20000);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ t: "subscribe", channels: [{ kind: "status", key: "*" }] })));
      socket.addEventListener("error", () => { clearTimeout(timeout); reject(Error("Live socket failed")); });
      socket.addEventListener("message", (event: any) => {
        const message = JSON.parse(String(event.data));
        if (message.t === "ping") socket.send(JSON.stringify({ t: "pong" }));
        if (message.t === "snapshot" || message.t === "status") { clearTimeout(timeout); resolve(); }
      });
    });
    return Math.round(performance.now() - start);
  };
  try {
    const earlyLive = optimized ? live() : null;
    // Attach rejection immediately while bootstrap is pending.
    const observedLive = earlyLive?.then(value => ({ value }), error => ({ error }));
    const readiness = optimized ? await sharedReadiness(transport) : await probeReadiness(transport);
    if (readiness.status !== "ready") throw Error(`Computer ${readiness.status}`);
    const readyMs = Math.round(performance.now() - start);
    const laterLive = observedLive ?? live().then(value => ({ value }), error => ({ error }));
    const sessions = await transport.request<{ sessions: unknown[] }>("/api/sessions");
    if (!Array.isArray(sessions.sessions)) throw Error("Missing sessions");
    const listMs = Math.round(performance.now() - start);
    const result = await laterLive;
    if ("error" in result) throw result.error;
    const usableMs = Math.max(listMs, result.value);
    const coldGrants = grants;
    close();
    const beforeRefresh = grants;
    await Promise.all([owner.get({ forceRefresh: true }), owner.get({ forceRefresh: true }), owner.get({ forceRefresh: true })]);
    return { readyMs, listMs, liveMs: result.value, usableMs, coldGrants, refreshGrants: grants - beforeRefresh };
  } finally { close(); }
}
function App() {
  const [lines, setLines] = useState(["Reconnect timing test", "Account token supplied; grant and all computer requests are live."]);
  useEffect(() => {
    let active = true;
    const add = (line: string) => { if (active) setLines(old => [...old, line]); };
    void (async () => {
      for (let round = 0; round < 3; round++) {
        for (const optimized of round % 2 ? [true, false] : [false, true]) {
          const result = await run(optimized);
          if (optimized && (result.coldGrants !== 1 || result.refreshGrants !== 1)) throw Error("Duplicate optimized grant mint");
          add(`${optimized ? "Parallel" : "Previous"} ${round + 1}: ready ${result.readyMs} ms; live ${result.liveMs} ms; content ${result.usableMs} ms; refreshes ${result.refreshGrants}`);
        }
      }
      add("Live reconnect comparison passed");
    })().catch(error => add(`FAILED: ${error.message}`));
    return () => { active = false; };
  }, []);
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#111" }}><ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} onContentSizeChange={() => recordConnectionTiming("benchmark.layout")}>
    {lines.map(line => <Text key={line} style={{ color: "white", fontSize: 16 }}>{line}</Text>)}
    <ConnectionTimingsRow active />
  </ScrollView></SafeAreaView>;
}
registerRootComponent(App);
