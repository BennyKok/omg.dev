import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getAuthToken } from "./auth";
import { CONTROLPLANE_ORIGIN } from "./config";
import { DropdownMenu } from "./menu";
import { Text } from "./text";
import { useTheme } from "./theme";

export type ReportSelection = { source: "session" | "thread"; sourceId: string; content?: string; messageId?: string; participantId?: string };
const reasons = [
  ["harmful", "Harmful or illegal content"], ["harassment", "Harassment or hate"],
  ["sexual", "Sexual content"], ["privacy", "Privacy or personal information"], ["other", "Other"],
] as const;

export async function submitContentReport(report: ReportSelection & { reason: string; note: string }) {
  const token = await getAuthToken();
  if (!token) throw new Error("Please sign in to send a report.");
  const response = await fetch(`${CONTROLPLANE_ORIGIN}/api/contentReports/submit`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.reportId !== "string") throw new Error("The report could not be sent. Please try again.");
  return result.reportId as string;
}

/** The user reviews and edits exactly what is sent. No full transcript upload. */
export function ContentReport({ selection, onClose }: { selection: ReportSelection; onClose: () => void }) {
  const { colors, type, space } = useTheme();
  const insets = useSafeAreaInsets();
  const [content, setContent] = useState((selection.content ?? "").slice(0, 10000));
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<string>("harmful");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (state !== "idle" || !note.trim()) return;
    setState("sending"); setError(null);
    try { await submitContentReport({ ...selection, content, note, reason }); setState("sent"); }
    catch { setError("The report could not be sent. Check your connection and try again."); setState("idle"); }
  };
  const inputStyle = { ...type.body, color: colors.text, backgroundColor: colors.card, borderRadius: 12, padding: 14, textAlignVertical: "top" as const };
  return (
    <Modal visible animationType="slide" onRequestClose={() => { if (state !== "sending") onClose(); }}>
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ flexDirection: "row", padding: space.lg, alignItems: "center" }}>
          <Text style={{ ...type.headline, color: colors.text, flex: 1 }}>Report content</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close report" disabled={state === "sending"} onPress={onClose}>
            <Text style={{ ...type.body, color: colors.primary }}>Close</Text>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.md }}>
          {state === "sent" ? <Text accessibilityRole="alert" style={{ ...type.body, color: colors.text }}>Report sent. We will review it.</Text> : <>
            <Text style={{ ...type.body, color: colors.textSecondary }}>Describe the content or user you want to report. Only the text below and your report will be sent to omg.dev for review.</Text>
            <DropdownMenu title="Report reason" options={reasons.map(([value, label]) => ({ label, onPress: () => setReason(value) }))}>
              <View style={{ padding: 14, backgroundColor: colors.card, borderRadius: 12 }}><Text style={{ ...type.body, color: colors.text }}>{reasons.find(([value]) => value === reason)?.[1]}</Text></View>
            </DropdownMenu>
            <TextInput accessibilityLabel="Report description" placeholder="What happened?" placeholderTextColor={colors.textMuted} value={note} onChangeText={setNote} maxLength={2000} multiline editable={state === "idle"} style={[inputStyle, { minHeight: 110 }]} />
            <Text style={{ ...type.subhead, color: colors.text }}>Content to include (optional)</Text>
            <TextInput accessibilityLabel="Reported content" value={content} onChangeText={setContent} maxLength={10000} multiline editable={state === "idle"} style={[inputStyle, { minHeight: 160 }]} />
            {error ? <Text accessibilityRole="alert" style={{ ...type.body, color: colors.danger }}>{error}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Send report" disabled={!note.trim() || state !== "idle"} onPress={() => void send()} style={{ borderRadius: 12, padding: 16, backgroundColor: colors.primary, opacity: !note.trim() || state !== "idle" ? 0.5 : 1 }}>
              {state === "sending" ? <ActivityIndicator /> : <Text style={{ ...type.body, fontWeight: "600", textAlign: "center", color: colors.bg }}>Send report</Text>}
            </Pressable>
          </>}
        </ScrollView>
      </View>
    </Modal>
  );
}
