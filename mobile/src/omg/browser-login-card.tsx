import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Image, Pressable, View } from "react-native";
import { SymbolView } from "expo-symbols";
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
  /**
   * ONE ROW: the site, then the verb, then the dismissal.
   *
   * This used to be a five-line card — icon and host, "Website login", the
   * reason the agent gave, "Login for <computer>", a sentence telling you to
   * sign in, then a full-width button and a "Cancel" word. Standing in the
   * transcript that is a panel, and every line of it was already known: the
   * reason is in the agent's own message directly above, and the target
   * computer is named again in the native consent alert you have to pass
   * through anyway. What is left is the only thing the row has to say —
   * WHICH SITE — and the only thing it has to offer: log in, or do not.
   *
   * The right-hand slot is one slot, not a stack. It holds the button while
   * the request is live, and the outcome once it is not, so the row never
   * changes height and never grows a second line.
   */
  const dismiss = () => {
    void post(request!.id, "cancel").then(refresh).catch(() => setError("Could not cancel. Try again."));
  };
  const status = !request ? null
    : request.status === "imported" ? { text: request.agentNotified ? "Signed in" : "Signed in. Tell the agent.", color: colors.success }
    : request.status === "failed" ? { text: request.message || "Could not transfer the login.", color: colors.destructive }
    : busy || request.status === "importing" ? { text: "Transferring…", color: colors.mutedForeground }
    : request.status === "in_progress" ? { text: "Open on a device", color: colors.mutedForeground }
    : !browserLoginNative ? { text: "Use the web Computer view", color: colors.mutedForeground }
    : null;
  return <View testID="browser-login-card" style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, paddingVertical: 8, paddingLeft: 12, paddingRight: 8, gap: 8 }}>
    {request && <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <WebsiteIcon key={request.origin} origin={request.origin} />
      <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: 16, fontWeight: "600" }}>{new URL(request.origin).hostname}</Text>
      {status
        ? <Text numberOfLines={1} style={{ flexShrink: 1, color: status.color, fontSize: 13 }}>{status.text}</Text>
        : <Pressable accessibilityRole="button" testID="browser-login-open" disabled={busy} onPress={() => void open(request)}
          style={{ minHeight: 34, paddingVertical: 7, paddingHorizontal: 16, borderRadius: 999, backgroundColor: colors.primary, opacity: busy ? 0.6 : 1, justifyContent: "center" }}>
          <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>Log in</Text>
        </Pressable>}
      {/* A cross, not the word. "Cancel" beside "Log in" read as a second
          choice of equal weight; this is the dismissal every card on iOS
          carries in its corner. 44pt of target through hitSlop, because the
          glyph is small on purpose. */}
      {request.status !== "imported" && <Pressable accessibilityRole="button" accessibilityLabel="Cancel the login request"
        testID="browser-login-cancel" hitSlop={10} disabled={busy || request.status === "importing"} onPress={dismiss}
        style={({ pressed }) => ({ width: 30, height: 30, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}>
        <SymbolView name="xmark" size={14} weight="semibold" tintColor={colors.mutedForeground} style={{ width: 14, height: 14 }} />
      </Pressable>}
    </View>}
    {error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
  </View>;
}
