import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, useWindowDimensions, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { expoConnectActive, expoConnectMessage, type ExpoAccountSnapshot } from "../../../packages/protocol/src/expo-account";
import { PROJECT_PREVIEW_RESTART_MESSAGE, type ProjectPreview, type ProjectPreviewSnapshot } from "../../../packages/protocol/src/project-preview";
import type { OmgTransport } from "@omg-dev/client";
import { Icon } from "../components";
import { STORAGE_KEYS } from "./config";
import { openInAppPage } from "./in-app-browser";
import { useOmg } from "./provider";
import { useTheme } from "./theme";
import { Text } from "./text";

export function ProjectPreviewCard({ sessionId }: { sessionId: string | null }) {
  const { client, user } = useOmg();
  return <ProjectPreviewPanel sessionId={sessionId} transport={client?.transport ?? null} email={user?.email} />;
}

export function ProjectPreviewPanel({ sessionId, transport, email, onOpenComputer = openComputer }: {
  sessionId: string | null; transport: Pick<OmgTransport, "request"> | null; email?: string;
  /** Shows the Computer screen, where the Expo login page is open. */
  onOpenComputer?: () => void;
}) {
  const { colors } = useTheme();
  // On a narrow phone the main action already says "Expo Go"; the chip shows
  // only where the title keeps room.
  const roomy = useWindowDimensions().width >= 480;
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  // Closed by default: on a phone the main path is "Open in Expo Go", and the
  // steps took a large part of the screen above the composer. The choice is
  // kept for every card on this device.
  const [guide, setGuideState] = useState(false);
  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEYS.previewCardExpanded)
      .then((value) => { if (value === "1" && mounted.current) setGuideState(true); })
      .catch(() => {});
  }, []);
  const setGuide = (value: boolean) => {
    setGuideState(value);
    void AsyncStorage.setItem(STORAGE_KEYS.previewCardExpanded, value ? "1" : "0").catch(() => {});
  };
  const [live, setLive] = useState<boolean | undefined>(undefined);
  const [expired, setExpired] = useState(false);
  const [restartAsked, setRestartAsked] = useState(false);
  // The Computer's Expo CLI account. null: an older Computer without the
  // route, so the card keeps "Open in Expo Go" as before.
  const [account, setAccount] = useState<ExpoAccountSnapshot | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const mounted = useRef(true);
  const suffix = `?sessionId=${encodeURIComponent(sessionId ?? "")}&user=${encodeURIComponent(email ?? "")}`;
  const refresh = useCallback(async () => {
    if (!transport || !sessionId || AppState.currentState !== "active") return;
    try {
      const data = await transport.request<ProjectPreviewSnapshot>(`/api/project-preview${suffix}`);
      if (!mounted.current) return;
      // A preview that has never answered is still starting: no card yet,
      // so a new Expo link does not read as "Stopped" while Metro boots.
      setPreview(data.starting ? null : data.preview ?? null);
      setLive(data.live);
      setExpired(data.expired === true);
      if (!data.starting && data.preview?.expoGoUrl) {
        try {
          const snapshot = await transport.request<ExpoAccountSnapshot>(`/api/expo-account${suffix}`);
          if (mounted.current) setAccount(snapshot && typeof snapshot.signedIn === "boolean" ? snapshot : null);
        } catch { if (mounted.current) setAccount(null); /* A Computer from before Connect Expo. */ }
      }
    } catch { /* Compatible with Computers from before preview cards. */ }
  }, [transport, sessionId, suffix]);
  useEffect(() => {
    mounted.current = true;
    setPreview(null);
    setAccount(null);
    void refresh();
    const poll = setInterval(() => void refresh(), 3_000);
    const app = AppState.addEventListener("change", () => void refresh());
    return () => { mounted.current = false; clearInterval(poll); app.remove(); };
  }, [refresh]);
  // A new preview row means the agent restarted it; allow another restart ask.
  useEffect(() => { setRestartAsked(false); }, [preview?.createdAt]);
  if (!preview) return null;
  const expoGoUrl = preview.expoGoUrl;
  const stopped = live === false;
  const restart = async () => {
    if (!transport || !sessionId || restartAsked) return;
    setRestartAsked(true);
    try {
      await transport.request(`/api/sessions/${encodeURIComponent(sessionId)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: PROJECT_PREVIEW_RESTART_MESSAGE }),
      });
    } catch { setRestartAsked(false); }
  };
  const openExpoGo = async () => {
    // Opening an unregistered scheme rejects, so a failure means Expo Go is
    // not installed. canOpenURL would need a native scheme allowlist.
    // TODO(expo-go-58): when Expo Go 58 is on the App Store, add
    // `expo_go_prompt_device_auth=1` to this link while the Computer's Expo
    // account is signed in, so Expo Go offers to sign in to the same account.
    try { await Linking.openURL(expoGoUrl!); } catch { setGuideState(true); }
  };
  const postAccount = async (action: "connect" | "cancel") => {
    if (!transport || !sessionId) return;
    setConnectBusy(true);
    setConnectError(null);
    try {
      const snapshot = await transport.request<ExpoAccountSnapshot>(`/api/expo-account/${action}${suffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!mounted.current) return;
      if (snapshot && typeof snapshot.signedIn === "boolean") setAccount(snapshot);
      if (action === "connect") onOpenComputer();
    } catch (error) {
      if (mounted.current) setConnectError(error instanceof Error && error.message ? error.message : "Could not start Expo sign-in. Try again.");
    } finally {
      if (mounted.current) setConnectBusy(false);
    }
  };
  // Only an Expo Go preview that runs checks the account. No account answer
  // (an older Computer) keeps today's "Open in Expo Go".
  const expoAccount = expoGoUrl && !stopped ? account : null;
  const connecting = expoConnectActive(expoAccount?.connect);
  const needsConnect = !!expoAccount && !expoAccount.signedIn;
  const status = expired ? "Link expired" : stopped ? "Stopped" : expoGoUrl ? null : "Live preview";
  return <View testID="project-preview-card" style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, paddingVertical: 6, paddingLeft: 8, paddingRight: 6, gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}>
      <Pressable accessibilityRole="button" testID="project-preview-toggle" disabled={!expoGoUrl || stopped}
        accessibilityState={expoGoUrl && !stopped ? { expanded: guide } : undefined}
        onPress={() => setGuide(!guide)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}>
          {expoGoUrl
            ? <Icon ios="iphone" android="smartphone" size={17} color={colors.primary} />
            : <Icon ios="globe" android="public" size={17} color={colors.primary} />}
        </View>
        <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" }}>{preview.title}</Text>
        {status
          ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{status}</Text>
          : !roomy ? null : <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 11, fontWeight: "600" }}>Expo Go</Text>
            </View>}
        {expoGoUrl && !stopped
          ? <Icon ios={guide ? "chevron.up" : "chevron.down"} android={guide ? "expand_less" : "expand_more"} size={13} color={colors.mutedForeground} />
          : null}
      </Pressable>
      {stopped || (needsConnect && connecting) ? null : needsConnect ? <Pressable accessibilityRole="button" testID="project-preview-connect-expo" disabled={connectBusy} onPress={() => void postAccount("connect")} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 999, backgroundColor: connectBusy ? colors.muted : colors.primary, justifyContent: "center" }}>
        <Text style={{ color: connectBusy ? colors.mutedForeground : colors.primaryForeground, fontWeight: "600", fontSize: 14 }}>Connect Expo</Text>
      </Pressable> : <Pressable accessibilityRole="button" testID={expoGoUrl ? "project-preview-expo-go" : "project-preview-open"} onPress={() => void (expoGoUrl ? openExpoGo() : openInAppPage(preview.url))} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.primary, justifyContent: "center" }}>
        <Text style={{ color: colors.primaryForeground, fontWeight: "600", fontSize: 14 }}>{expoGoUrl ? "Open in Expo Go" : "Open preview"}</Text>
      </Pressable>}
      {!stopped && !expoGoUrl
        ? <Pressable accessibilityRole="button" accessibilityLabel="Open preview in Safari" onPress={() => void Linking.openURL(preview.url)} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
            <Icon ios="arrow.up.forward.app" android="open_in_new" size={18} color={colors.mutedForeground} />
          </Pressable>
        : null}
    </View>
    {expoAccount ? <ExpoAccountRow account={expoAccount} connecting={connecting} error={connectError} busy={connectBusy}
      onOpenComputer={onOpenComputer} onCancel={() => void postAccount("cancel")} /> : null}
    {stopped ? <View testID="project-preview-stopped" style={{ gap: 10, paddingHorizontal: 4, paddingBottom: 6 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>{expired
        ? "The Expo Go link expired. Restart the preview to get a new one."
        : "The development server is not running. This happens when the Computer sleeps."}</Text>
      <Pressable accessibilityRole="button" testID="project-preview-restart" disabled={restartAsked} onPress={() => void restart()} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: restartAsked ? colors.muted : colors.primary, justifyContent: "center" }}>
        <Text style={{ color: restartAsked ? colors.mutedForeground : colors.primaryForeground, fontWeight: "600", textAlign: "center" }}>{restartAsked ? "Asked the agent to restart it" : "Restart preview"}</Text>
      </Pressable>
    </View> : expoGoUrl && guide ? <View testID="project-preview-expo-guide" style={{ gap: 6, paddingHorizontal: 4, paddingBottom: 4 }}>
      {/* This card is on the phone that runs Expo Go, so it has no QR code:
          one line for a person who does not have Expo Go yet. */}
      <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>
        Need Expo Go?{" "}
        <Text testID="project-preview-get-expo-go" accessibilityRole="link" onPress={() => void Linking.openURL(Platform.OS === "android" ? EXPO_GO_ANDROID : EXPO_GO_IOS)} style={{ color: colors.primary, fontWeight: "600" }}>{Platform.OS === "android" ? "Get it on Google Play" : "Get it on the App Store"}</Text>
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Pressable accessibilityRole="link" accessibilityLabel="Open web preview" testID="project-preview-open" onPress={() => void openInAppPage(preview.url)} style={{ minHeight: 32, justifyContent: "center" }}>
          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>Web preview</Text>
        </Pressable>
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>·</Text>
        <Pressable accessibilityRole="link" accessibilityLabel={Platform.OS === "android" ? "Open preview in browser" : "Open preview in Safari"} testID="project-preview-open-browser" onPress={() => void Linking.openURL(preview.url)} style={{ minHeight: 32, justifyContent: "center" }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{Platform.OS === "android" ? "Browser" : "Safari"}</Text>
        </Pressable>
      </View>
    </View> : null}
  </View>;

}

function openComputer() { router.push("/computer"); }

function ExpoAccountRow({ account, connecting, error, busy, onOpenComputer, onCancel }: {
  account: ExpoAccountSnapshot; connecting: boolean; error: string | null; busy: boolean;
  onOpenComputer: () => void; onCancel: () => void;
}) {
  const { colors } = useTheme();
  if (account.signedIn) {
    return <Text testID="project-preview-expo-account" style={{ color: colors.mutedForeground, fontSize: 13, paddingHorizontal: 4, paddingBottom: 4 }}>
      {account.username ? `Sign in to Expo Go as ${account.username}.` : "Sign in to Expo Go with the Computer's Expo account."}
    </Text>;
  }
  const last = account.connect && !connecting && account.connect.state !== "done" ? expoConnectMessage(account.connect) : null;
  return <View testID="project-preview-expo-connect" style={{ gap: 4, paddingHorizontal: 4, paddingBottom: 4 }}>
    {connecting && account.connect ? <>
      <Text testID="project-preview-expo-connect-status" style={{ color: colors.foreground, fontSize: 14 }}>{expoConnectMessage(account.connect)}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Pressable accessibilityRole="link" testID="project-preview-open-computer" onPress={onOpenComputer} style={{ minHeight: 32, justifyContent: "center" }}>
          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>Open Computer</Text>
        </Pressable>
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>·</Text>
        <Pressable accessibilityRole="link" testID="project-preview-cancel-expo" disabled={busy} onPress={onCancel} style={{ minHeight: 32, justifyContent: "center" }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Cancel</Text>
        </Pressable>
      </View>
    </> : <>
      {last ? <Text testID="project-preview-expo-connect-status" style={{ color: colors.foreground, fontSize: 13 }}>{last}</Text> : null}
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>iPhone needs Expo signed in on the Computer.</Text>
    </>}
    {error ? <Text testID="project-preview-expo-connect-error" style={{ color: colors.destructive, fontSize: 13 }}>{error}</Text> : null}
  </View>;
}

const EXPO_GO_IOS = "https://apps.apple.com/app/expo-go/id982107779";
const EXPO_GO_ANDROID = "https://play.google.com/store/apps/details?id=host.exp.exponent";
