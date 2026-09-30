import { type MenuAction } from "@expo/ui/community/menu";
import { HoldMenu } from "./hold-menu";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Modal, Pressable, useWindowDimensions, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import { Text, TextInput } from "./text";
import { useTheme } from "./theme";
import { useBodyText } from "./markdown";

type Selection = ReturnType<typeof useSelectText>;

/**
 * A reply opens the same native hold menu as the sent bubble: Copy and Select
 * text. No visible button: a control under every reply read as clutter. The
 * reply's markdown is not `selectable` (see TranscriptBody), because the
 * native selection gesture is also a long press and would win.
 *
 * THE CONTENT NEEDS A NUMBER. MenuView hosts its child in SwiftUI
 * (`RNHostView matchContents`), which measures the RN child as a leaf with no
 * width limit, so a percentage or a stretch never reaches the text. The row
 * is measured outside the menu and its width is handed in as a number, the
 * same fix the sent bubble uses. `widthFraction` below 1 makes it a maximum
 * (the bot bubble sizes to its text); 1 fills the row.
 */
export function ReplyTextActions({ text, children, style, widthFraction = 1 }: {
  text: string; children: ReactNode; style?: ViewStyle; widthFraction?: number;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const width = Math.floor((rowWidth ?? windowWidth - 48) * widthFraction);
  const fill = widthFraction >= 1;
  return (
    <View style={{ alignSelf: "stretch" }} onLayout={event => setRowWidth(event.nativeEvent.layout.width)}>
      <MessageTextActions text={text} align={fill ? "stretch" : "flex-start"}>
        <View accessibilityHint="Press and hold for Copy and Select text" style={[style, fill ? { width } : { maxWidth: width }]}>
          {children}
        </View>
      </MessageTextActions>
    </View>
  );
}

/** Native hold menu with Copy and Select text. The sent bubble passes its own Copy. */
export function MessageTextActions({ text, children, onCopy, align = "stretch" }: {
  text: string; children: ReactNode; onCopy?: () => void; align?: "stretch" | "flex-start";
}) {
  const { isDark, colors, type } = useTheme();
  const selection = useSelectText();
  const [note, setNote] = useState("");
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (noteTimer.current) clearTimeout(noteTimer.current); }, []);
  const copyAll = async () => {
    const ok = await selection.copy(text);
    setNote(ok ? "Copied" : "Could not copy. Try again.");
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(""), 1500);
  };
  if (!text.trim()) return <>{children}</>;
  return <>
    <HoldMenu
      actions={[
        { id: "copy", title: "Copy", image: "doc.on.doc" },
        { id: "select", title: "Select text", image: "text.cursor" },
      ] satisfies MenuAction[]}
      isDark={isDark}
      style={{ alignSelf: align }}
      onAction={(id) => {
        if (id === "copy") {
          if (onCopy) onCopy();
          else void copyAll();
        }
        if (id === "select") selection.open(text);
      }}
    >
      {children}
    </HoldMenu>
    {note ? <Text accessibilityLiveRegion="polite" style={{ ...type.caption, color: colors.textMuted }}>{note}</Text> : null}
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
