import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, View } from "react-native";
import type { ProjectPreview, ProjectPreviewSnapshot } from "../../../packages/protocol/src/project-preview";
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
  const mounted = useRef(true);
  const suffix = `?sessionId=${encodeURIComponent(sessionId ?? "")}&user=${encodeURIComponent(email ?? "")}`;
  const refresh = useCallback(async () => {
    if (!transport || !sessionId || AppState.currentState !== "active") return;
    try {
      const data = await transport.request<ProjectPreviewSnapshot>(`/api/project-preview${suffix}`);
      if (mounted.current) setPreview(data.preview ?? null);
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
  if (!preview) return null;
  return <View testID="project-preview-card" style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}>
        <Icon ios="globe" android="public" size={22} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>{preview.title}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Live preview · Private to you · Temporary</Text>
      </View>
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Pressable accessibilityRole="button" testID="project-preview-open" onPress={() => void openInAppPage(preview.url)} style={{ flex: 1, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.primary, justifyContent: "center" }}>
        <Text style={{ color: colors.primaryForeground, fontWeight: "600", textAlign: "center" }}>Open preview</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Open preview in Safari" onPress={() => void Linking.openURL(preview.url)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
        <Icon ios="arrow.up.forward.app" android="open_in_new" size={20} color={colors.mutedForeground} />
      </Pressable>
    </View>
  </View>;
}
