/** Simulator fixture using the production transcript, menu and text renderers. */
import { registerRootComponent } from "expo";
import { ScrollView, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { TranscriptEntry } from "../src/omg/transcript";
import { Text } from "../src/omg/text";
import { useTheme } from "../src/omg/theme";
import { useLucideFont } from "../src/omg/lucide";

function App() {
  const { colors } = useTheme();
  if (!useLucideFont()) return null;
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      <Text style={{ color: colors.text, fontSize: 20 }}>Chat recovery check</Text>
      <View><TranscriptEntry message={{ id: "hi", role: "user", kind: "text", text: "Hi   \n\n", ts: 1 }} /></View>
      <View><TranscriptEntry message={{ id: "old-error", role: "assistant", kind: "text", text: "OpenCode returned no assistant output for omg/openai/gpt-6-luna; check the OpenCode provider logs.", ts: 2 }} /></View>
      <View><TranscriptEntry message={{ id: "long", role: "user", kind: "text", text: "Please check this long message. https://example.com/this-is-a-long-path-that-must-wrap-inside-the-message-bubble-and-stay-on-the-screen", ts: 3 }} /></View>
      <View><TranscriptEntry message={{ id: "multiline", role: "user", kind: "text", text: "First line\nSecond line", ts: 4 }} /></View>
    </ScrollView>
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(App);
