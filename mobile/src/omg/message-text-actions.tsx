import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Text, TextInput } from "./text";
import { useTheme } from "./theme";
import { useBodyText } from "./markdown";

/** One native text view lets selection span paragraphs, lists, and code. */
export function MessageTextActions({ text, label = "Select text" }: { text: string; label?: string }) {
  const { colors, type, space } = useTheme();
  const body = useBodyText();
  const insets = useSafeAreaInsets();
  // Freeze the message while selecting, including when a reply is streaming.
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [status, setStatus] = useState("");
  const selectedText = snapshot?.slice(selection.start, selection.end) ?? "";
  const close = () => setSnapshot(null);
  const copy = async (value: string) => {
    try {
      await Clipboard.setStringAsync(value);
      setStatus("Copied");
    } catch {
      setStatus("Could not copy. Try again.");
    }
  };
  const button = (title: string, onPress: () => void, disabled = false, accessibilityLabel = title) => (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled}
      onPress={onPress} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: space.sm, opacity: disabled ? 0.4 : 1 }}>
      <Text style={{ ...type.footnote, color: colors.textSecondary }}>{title}</Text>
    </Pressable>
  );

  if (!text.trim()) return null;
  return <>
    {button("Select text", () => {
      setSelection({ start: 0, end: 0 });
      setStatus("");
      setSnapshot(text);
    }, false, label)}
    <Modal visible={snapshot !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, space.md) }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.md }}>
          <Text accessibilityRole="header" style={{ ...type.title, color: colors.text }}>Select text</Text>
          {button("Done", close)}
        </View>
        <Text style={{ ...type.footnote, color: colors.textMuted, paddingHorizontal: space.lg, paddingBottom: space.sm }}>
          Touch and hold a word, then drag the handles to select text.
        </Text>
        {snapshot !== null ? <TextInput
          testID="message-selection-text"
          accessibilityLabel="Message text"
          value={snapshot}
          multiline
          editable={false}
          scrollEnabled
          onSelectionChange={event => {
            setSelection(event.nativeEvent.selection);
            setStatus("");
          }}
          style={{ ...body, flex: 1, paddingHorizontal: space.lg, paddingVertical: space.md, textAlignVertical: "top" }}
        /> : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.md }}>
          {button("Copy selection", () => { void copy(selectedText); }, !selectedText)}
          {button("Copy all", () => { if (snapshot !== null) void copy(snapshot); })}
        </View>
        {status ? <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: colors.textSecondary, textAlign: "center" }}>{status}</Text> : null}
      </View>
    </Modal>
  </>;
}
