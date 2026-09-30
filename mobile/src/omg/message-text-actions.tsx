import MenuView, { type MenuAction } from "@expo/ui/community/menu";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ActionSheetIOS, Alert, Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Text, TextInput } from "./text";
import { useTheme } from "./theme";
import { useBodyText } from "./markdown";

type Selection = ReturnType<typeof useSelectText>;

/**
 * A reply opens Copy and Select text on press-and-hold, like the sent bubble.
 * No visible button: a control under every reply read as clutter. The reply's
 * markdown is not `selectable` (see TranscriptBody), because the native
 * selection gesture is also a long press and would win. Selection across
 * paragraphs lives in the Select text screen instead.
 *
 * Not the SwiftUI context menu the sent bubble uses: that hosts its child in
 * SwiftUI (`RNHostView`), which measures a long, virtualized, streaming reply
 * badly. A Pressable plus the system action sheet leaves the layout alone.
 */
export function ReplyTextActions({ text, children }: { text: string; children: ReactNode }) {
  const { colors, type } = useTheme();
  const selection = useSelectText();
  const [note, setNote] = useState("");
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);
  const copyReply = async () => {
    const ok = await selection.copy(text);
    setNote(ok ? "Copied" : "Could not copy. Try again.");
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(""), 1500);
  };
  const open = () => {
    if (!text.trim()) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const choose = (index: number) => {
      if (index === 0) void copyReply();
      if (index === 1) selection.open(text);
    };
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ options: ["Copy", "Select text", "Cancel"], cancelButtonIndex: 2 }, choose);
    } else {
      Alert.alert("Reply", undefined, [
        { text: "Copy", onPress: () => choose(0) },
        { text: "Select text", onPress: () => choose(1) },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };
  return <>
    <Pressable accessibilityHint="Press and hold for Copy and Select text" accessibilityActions={[{ name: "longpress", label: "Copy or select text" }]}
      onAccessibilityAction={open} onLongPress={open} delayLongPress={400} style={{ alignSelf: "stretch" }}>
      {children}
    </Pressable>
    {note ? <Text accessibilityLiveRegion="polite" style={{ ...type.caption, color: colors.textMuted }}>{note}</Text> : null}
    <SelectTextModal selection={selection} />
  </>;
}

/** The sent bubble keeps its native hold menu, now with Select text. */
export function MessageTextActions({ text, children, onCopy }: { text: string; children: ReactNode; onCopy?: () => void }) {
  const { isDark } = useTheme();
  const selection = useSelectText();
  if (!text.trim()) return <>{children}</>;
  return <>
    <MenuView
      actions={[
        { id: "copy", title: "Copy", image: "doc.on.doc" },
        { id: "select", title: "Select text", image: "text.cursor" },
      ] satisfies MenuAction[]}
      shouldOpenOnLongPress
      colorScheme={isDark ? "dark" : "light"}
      style={{ alignSelf: "stretch" }}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "copy") {
          if (onCopy) onCopy();
          else void selection.copy(text);
        }
        if (nativeEvent.event === "select") selection.open(text);
      }}
    >
      {children}
    </MenuView>
    <SelectTextModal selection={selection} />
  </>;
}

function useSelectText() {
  // Freeze the message while selecting, including when a reply is streaming.
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [status, setStatus] = useState("");
  const copy = async (value: string) => {
    try {
      await Clipboard.setStringAsync(value);
      setStatus("Copied");
      return true;
    } catch {
      setStatus("Could not copy. Try again.");
      return false;
    }
  };
  return {
    snapshot, range, status, copy,
    open: (value: string) => { setRange({ start: 0, end: 0 }); setStatus(""); setSnapshot(value); },
    close: () => setSnapshot(null),
    select: (next: { start: number; end: number }) => { setRange(next); setStatus(""); },
  };
}

/** One native text view lets selection span paragraphs, lists, and code. */
function SelectTextModal({ selection }: { selection: Selection }) {
  const { colors, type, space } = useTheme();
  const body = useBodyText();
  const insets = useSafeAreaInsets();
  const { snapshot, range, status, copy, close } = selection;
  const selectedText = snapshot?.slice(range.start, range.end) ?? "";
  const button = (title: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled}
      onPress={onPress} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: space.sm, opacity: disabled ? 0.4 : 1 }}>
      <Text style={{ ...type.footnote, color: colors.textSecondary }}>{title}</Text>
    </Pressable>
  );
  return (
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
          onSelectionChange={event => selection.select(event.nativeEvent.selection)}
          style={{ ...body, flex: 1, paddingHorizontal: space.lg, paddingVertical: space.md, textAlignVertical: "top" }}
        /> : null}
        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.md }}>
          {button("Copy selection", () => { void copy(selectedText); }, !selectedText)}
          {button("Copy all", () => { if (snapshot !== null) void copy(snapshot); })}
        </View>
        {status ? <Text accessibilityLiveRegion="polite" style={{ ...type.footnote, color: colors.textSecondary, textAlign: "center" }}>{status}</Text> : null}
      </View>
    </Modal>
  );
}
