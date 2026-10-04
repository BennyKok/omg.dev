/** Simulator-only attachment layout proof using the production composers. */
import { registerRootComponent } from "expo";
import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AttachmentStrip, HomeComposer } from "../src/components";
import { ChatBarShell, useChatBarInputStyle } from "../src/omg/chat-bar";
import type { Attachment } from "../src/omg/attachments";
import { setDemoMode } from "../src/omg/demo";
import { useLucideFont } from "../src/omg/lucide";
import { OmgProvider } from "../src/omg/provider";
import { Text } from "../src/omg/text";
import { useTheme } from "../src/omg/theme";

void setDemoMode(true);
const image = Image.resolveAssetSource(require("../assets/icon.png")).uri;
const files: Attachment[] = [
  { id: "image", name: "photo.png", uri: image, kind: "image", path: null },
  { id: "video", name: "clip.mp4", uri: "fixture://clip", kind: "video", path: "/fixture/clip.mp4" },
  { id: "file", name: "notes.txt", uri: "fixture://notes", kind: "file", path: "/fixture/notes.txt" },
];

function Fixture() {
  const { colors } = useTheme();
  const [mode, setMode] = useState<"home" | "chat">("home");
  const [items, setItems] = useState(files);
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const inputStyle = useChatBarInputStyle(!!text);
  const remove = (id: string) => setItems((current) => current.filter((item) => item.id !== id));
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ padding: 20, gap: 12 }}>
          <Text style={{ fontSize: 20, color: colors.text }}>Composer attachment preview</Text>
          <Text style={{ color: colors.textSecondary }}>Isolated fixture. No upload or agent calls.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Show chat composer" onPress={() => { setMode("chat"); setItems(files); }}>
            <Text style={{ color: colors.primary }}>Show chat composer</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1 }} />
        {mode === "home" ? (
          <HomeComposer value={text} onChangeText={setText} onStart={() => {}}
            agent="codex" agentLabel="Codex" agentOptions={[]} projectOptions={[]}
            attachments={{ items, options: [], remove }} dictation={{ state: "idle", toggle: () => {} }} />
        ) : (
          <View style={{ padding: 16 }}>
            <ChatBarShell expanded={focused || !!text || items.length > 0}
              attachments={<AttachmentStrip items={items} onRemove={remove} />}
              expandedActions={<Text style={{ color: colors.textSecondary }}>Chat controls</Text>}>
              <TextInput testID="attachment-chat-input" accessibilityLabel="Chat draft" placeholder="Message"
                placeholderTextColor={colors.textMuted} value={text} onChangeText={setText}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} multiline style={inputStyle} />
            </ChatBarShell>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
function App() {
  if (!useLucideFont()) return null;
  return <SafeAreaProvider><OmgProvider><Fixture /></OmgProvider></SafeAreaProvider>;
}
registerRootComponent(App);
