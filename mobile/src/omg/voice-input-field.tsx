import { useRef, type ReactNode, type ElementRef } from "react";
import { ScrollView, View, type ViewStyle } from "react-native";
import { Text } from "./text";
import { useTheme } from "./theme";

export interface VoiceInputDisplay {
  state: "idle" | "recording" | "transcribing";
  committed?: string;
  partial?: string;
}
/** Keep the editable field mounted while a take displays stable and pending words. */
export function VoiceInputField({ draft, dictation, children, style, fontSize = 16, lineHeight = 21 }: {
  draft: string; dictation: VoiceInputDisplay; children: ReactNode;
  style?: ViewStyle; fontSize?: number; lineHeight?: number;
}) {
  const { colors } = useTheme();
  const scroll = useRef<ElementRef<typeof ScrollView>>(null);
  const active = dictation.state !== "idle";
  const stable = [draft.trim(), dictation.committed?.trim()].filter(Boolean).join(" ");
  const pending = dictation.partial?.trim() ?? "";
  return <View style={style}>
    <View pointerEvents={active ? "none" : "auto"} accessibilityElementsHidden={active}
      importantForAccessibility={active ? "no-hide-descendants" : "auto"}
      style={{ flexDirection: "row", width: "100%", position: active ? "absolute" : "relative", opacity: active ? 0 : 1 }}>
      {children}
    </View>
    {active && <ScrollView ref={scroll} style={{ maxHeight: lineHeight * 3, minHeight: lineHeight }}
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
      <Text testID="voice-live-transcript" style={{ fontSize, lineHeight, color: colors.text }}>
        {stable}
        <Text style={{ color: colors.textMuted }}>{pending ? `${stable ? " " : ""}${pending}` : stable ? "" : dictation.state === "recording" ? "Listening…" : "Finishing…"}</Text>
      </Text>
    </ScrollView>}
  </View>;
}
