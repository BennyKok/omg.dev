import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Image, Pressable, View } from "react-native";
import * as Crypto from "expo-crypto";
import { latestBrowserLoginRequest, type BrowserLoginRequest, type BrowserLoginSnapshot } from "../../../packages/protocol/src/browser-login";
import { browserLoginNative } from "./browser-login-native";
import { useOmg } from "./provider";
import { useTheme } from "./theme";
import { Text } from "./text";
import type { OmgTransport } from "@omg-dev/client";

function WebsiteIcon({ origin }: { origin: string }) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const host = new URL(origin).hostname;
  return <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
    {failed ? <Text accessibilityLabel={`${host} website`} style={{ color: colors.mutedForeground, fontSize: 20, fontWeight: "600" }}>{host.replace(/^www\./, "").charAt(0).toUpperCase()}</Text>
      : <Image source={{ uri: `${origin}/favicon.ico` }} accessible accessibilityLabel={loaded ? `${host} icon` : "Loading website icon"}
        onLoad={() => setLoaded(true)} onError={() => setFailed(true)} resizeMode="contain" style={{ width: 28, height: 28 }} />}
  </View>;
}

export function BrowserLoginCard({ sessionId }: { sessionId: string | null }) {
  const { client, user } = useOmg();
  return <BrowserLoginPanel key={`${sessionId}:${user?.email}`} sessionId={sessionId} transport={client?.transport ?? null} email={user?.email} />;
}

export function BrowserLoginPanel({ sessionId, transport, email }: {
  sessionId: string | null; transport: Pick<OmgTransport, "request"> | null; email?: string;
}) {
  const { colors } = useTheme();
  const [requests, setRequests] = useState<BrowserLoginRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientId] = useState(() => Crypto.randomUUID());
  const mounted = useRef(true);
  const suffix = `?sessionId=${encodeURIComponent(sessionId ?? "")}&user=${encodeURIComponent(email ?? "")}`;
  const refresh = useCallback(async () => {
    if (!transport || !sessionId || AppState.currentState !== "active") return;
    try {
      const data = await transport.request<BrowserLoginSnapshot>(`/api/browser-login${suffix}`);
      if (mounted.current) setRequests(data.requests ?? []);
    } catch { /* Older computers do not have this endpoint. */ }
  }, [transport, sessionId, suffix]);
  useEffect(() => {
    mounted.current = true;
    setRequests([]);
    const presence = async () => {
      if (!transport || !sessionId) return;
      await transport.request(`/api/browser-login/clients${suffix}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, supported: !!browserLoginNative && AppState.currentState === "active" }),
      }).catch(() => {});
    };
    void refresh(); void presence();
    const poll = setInterval(() => void refresh(), 3000);
    const lease = setInterval(() => void presence(), 15_000);
    const app = AppState.addEventListener("change", () => { void presence(); void refresh(); });
    return () => {
      mounted.current = false;
      clearInterval(poll); clearInterval(lease); app.remove();
      void browserLoginNative?.close();
      void transport?.request(`/api/browser-login/clients${suffix}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, supported: false }),
      }).catch(() => {});
    };
  }, [transport, sessionId, suffix, clientId, refresh]);
  const post = async (id: string, action: string, body: unknown = {}) => transport!.request<{ request: BrowserLoginRequest; token?: string }>(
    `/api/browser-login/${id}/${action}${suffix}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  const open = async (request: BrowserLoginRequest) => {
    if (!transport || !browserLoginNative || busy) return;
    setBusy(true); setError(null);
    let claimed = false;
    try {
      const { token } = await post(request.id, "claim"); claimed = true;
      const result = await browserLoginNative.open(request.url, request.computerName);
      if (result.cancelled || !mounted.current) { await post(request.id, "cancel"); return; }
      try {
        await post(request.id, "complete", { token, approved: true, cookies: result.cookies });
      } finally { if (result.cookies) result.cookies.length = 0; }
    } catch {
      // Native/transport exceptions can include request bodies. Do not log them.
      if (claimed) await post(request.id, "cancel").catch(() => {});
      if (mounted.current) setError("The login could not be transferred. Ask the agent to request it again.");
    } finally {
      if (mounted.current) { setBusy(false); await refresh(); }
    }
  };
  const request = latestBrowserLoginRequest(requests);
  if (!request && !error) return null;
  return <View testID="browser-login-card" style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 }}>
    {request && <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <WebsiteIcon key={request.origin} origin={request.origin} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>{new URL(request.origin).hostname}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Website login</Text>
        </View>
      </View>
      <Text style={{ color: colors.mutedForeground }}>{request.reason}</Text>
      <Text style={{ color: colors.mutedForeground }}>Login for {request.computerName}</Text>
      {request.status === "imported" ? <Text style={{ color: colors.success }}>{request.agentNotified ? "Login transferred. The agent has been notified." : "Login transferred. Tell the agent to check the page."}</Text>
        : request.status === "failed" ? <Text style={{ color: colors.destructive }}>{request.message}</Text>
        : <>
          <Text style={{ color: colors.mutedForeground }}>{busy || request.status === "importing" ? "Transferring login…" : request.status === "in_progress" ? "Login is open on a device." : "Sign in, then choose whether to share this login with your computer."}</Text>
          {!browserLoginNative && <Text style={{ color: colors.mutedForeground }}>Update the iOS app to sign in here, or use the web Computer view.</Text>}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginTop: 4 }}>
            {!!browserLoginNative && request.status === "pending" && <Pressable accessibilityRole="button" testID="browser-login-open" disabled={busy} onPress={() => void open(request)} style={{ flex: 1, minHeight: 44, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.primary, opacity: busy ? 0.6 : 1, justifyContent: "center" }}>
              <Text style={{ color: colors.primaryForeground, fontWeight: "600", textAlign: "center" }}>Log in to {new URL(request.origin).hostname}</Text>
            </Pressable>}
            <Pressable accessibilityRole="button" disabled={busy || request.status === "importing"} onPress={() => {
              void post(request.id, "cancel").then(refresh).catch(() => setError("Could not cancel. Try again."));
            }} style={{ paddingVertical: 10 }}><Text style={{ color: colors.mutedForeground }}>Cancel</Text></Pressable>
          </View>
        </>}
    </>}
    {error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
  </View>;
}
