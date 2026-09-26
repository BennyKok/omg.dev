import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, Pressable, View } from "react-native";
import { PROJECT_PREVIEW_RESTART_MESSAGE, type ProjectPreview, type ProjectPreviewSnapshot } from "../../../packages/protocol/src/project-preview";
import type { OmgTransport } from "@omg-dev/client";
import { Icon } from "../components";
import { openInAppPage } from "./in-app-browser";
import { useOmg } from "./provider";
import { useTheme } from "./theme";
import { Text } from "./text";

export function ProjectPreviewCard({ sessionId }: { sessionId: string | null }) {
  const { client, user } = useOmg();
  return <ProjectPreviewPanel sessionId={sessionId} transport={client?.transport ?? null} email={user?.email} />;
}

export function ProjectPreviewPanel({ sessionId, transport, email }: {
  sessionId: string | null; transport: Pick<OmgTransport, "request"> | null; email?: string;
}) {
  const { colors } = useTheme();
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  const [guide, setGuide] = useState(false);
  const [live, setLive] = useState<boolean | undefined>(undefined);
  const [expired, setExpired] = useState(false);
  const [restartAsked, setRestartAsked] = useState(false);
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
    } catch { /* Compatible with Computers from before preview cards. */ }
  }, [transport, sessionId, suffix]);
  useEffect(() => {
    mounted.current = true;
    setPreview(null);
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
    try { await Linking.openURL(expoGoUrl!); } catch { setGuide(true); }
  };
  return <View testID="project-preview-card" style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}>
        {expoGoUrl
          ? <Icon ios="iphone" android="smartphone" size={22} color={colors.primary} />
          : <Icon ios="globe" android="public" size={22} color={colors.primary} />}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>{preview.title}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{expired ? "Link expired" : stopped ? "Stopped" : expoGoUrl ? "Expo app" : "Live preview"} · Private to you · Temporary</Text>
      </View>
    </View>
    {stopped ? <View testID="project-preview-stopped" style={{ gap: 10 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>{expired
        ? "The Expo Go link expired. Restart the preview to get a new one."
        : "The development server is not running. This happens when the Computer sleeps."}</Text>
      <Pressable accessibilityRole="button" testID="project-preview-restart" disabled={restartAsked} onPress={() => void restart()} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: restartAsked ? colors.muted : colors.primary, justifyContent: "center" }}>
        <Text style={{ color: restartAsked ? colors.mutedForeground : colors.primaryForeground, fontWeight: "600", textAlign: "center" }}>{restartAsked ? "Asked the agent to restart it" : "Restart preview"}</Text>
      </Pressable>
    </View> : <>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Pressable accessibilityRole="button" testID={expoGoUrl ? "project-preview-expo-go" : "project-preview-open"} onPress={() => void (expoGoUrl ? openExpoGo() : openInAppPage(preview.url))} style={{ flex: 1, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.primary, justifyContent: "center" }}>
        <Text style={{ color: colors.primaryForeground, fontWeight: "600", textAlign: "center" }}>{expoGoUrl ? "Open in Expo Go" : "Open preview"}</Text>
      </Pressable>
      {expoGoUrl
        ? <Pressable accessibilityRole="button" accessibilityLabel="Open web preview" testID="project-preview-open" onPress={() => void openInAppPage(preview.url)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <Icon ios="globe" android="public" size={20} color={colors.mutedForeground} />
          </Pressable>
        : <Pressable accessibilityRole="button" accessibilityLabel="Open preview in Safari" onPress={() => void Linking.openURL(preview.url)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <Icon ios="arrow.up.forward.app" android="open_in_new" size={20} color={colors.mutedForeground} />
          </Pressable>}
    </View>
    {expoGoUrl && <Pressable accessibilityRole="button" testID="project-preview-expo-guide-toggle" onPress={() => setGuide(value => !value)}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{guide ? "Hide steps" : "First time? See how it works"}</Text>
    </Pressable>}
    {expoGoUrl && guide && <View testID="project-preview-expo-guide" style={{ gap: 8, backgroundColor: colors.muted, borderRadius: 12, padding: 12 }}>
      <GuideStep colors={colors} n={1} text="Get Expo Go. It is free." />
      <Pressable accessibilityRole="button" testID="project-preview-get-expo-go" onPress={() => void Linking.openURL(Platform.OS === "android" ? EXPO_GO_ANDROID : EXPO_GO_IOS)} style={{ alignSelf: "flex-start", marginLeft: 26, minHeight: 36, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, justifyContent: "center" }}>
        <Text style={{ color: colors.foreground, fontWeight: "600" }}>{Platform.OS === "android" ? "Get it on Google Play" : "Get it on the App Store"}</Text>
      </Pressable>
      <GuideStep colors={colors} n={2} text="Come back and tap Open in Expo Go." />
      <GuideStep colors={colors} n={3} text="The first load can take up to a minute." />
    </View>}
    </>}
  </View>;

}

const EXPO_GO_IOS = "https://apps.apple.com/app/expo-go/id982107779";
const EXPO_GO_ANDROID = "https://play.google.com/store/apps/details?id=host.exp.exponent";

type ThemeColors = ReturnType<typeof useTheme>["colors"];

function GuideStep({ n, text, colors }: { n: number; text: string; colors: ThemeColors }) {
  return <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
    <Text style={{ width: 18, color: colors.primary, fontWeight: "700" }}>{n}.</Text>
    <Text style={{ flex: 1, color: colors.foreground, fontSize: 14 }}>{text}</Text>
  </View>;
}
