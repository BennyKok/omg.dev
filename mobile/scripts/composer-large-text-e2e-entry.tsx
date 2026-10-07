/** Simulator-only layout proof. Uses the production home composer. */
import { registerRootComponent } from "expo";
import { useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { OmgProvider } from "../src/omg/provider";
import { setDemoMode } from "../src/omg/demo";
import { HomeComposer } from "../src/components";
import { useLucideFont } from "../src/omg/lucide";
import { Text } from "../src/omg/text";
import { useTheme } from "../src/omg/theme";

void setDemoMode(true);

function Fixture() {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const [draft, setDraft] = useState("");
  if (!useLucideFont()) return null;
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <View style={{ padding: 20, gap: 16 }}>
        <Text style={{ color: colors.text, fontSize: 20 }}>Large text composer test</Text>
        <Text style={{ color: colors.textMuted }}>System text scale: {fontScale.toFixed(2)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Clear draft and close keyboard" onPress={() => { setDraft(""); Keyboard.dismiss(); }}>
          <Text style={{ color: colors.primary }}>Clear draft and close keyboard</Text>
        </Pressable>
      </View>
      <View style={{ flex: 1 }} />
      <HomeComposer value={draft} onChangeText={setDraft} onStart={() => {}}
        agent="codex" agentLabel="Codex" agentOptions={[{ id: "codex", label: "Codex", selected: true, onPress: () => {} }]} projectOptions={[]}
        attachments={{ items: [], options: [], remove: () => {} }} dictation={{ state: "idle", toggle: () => {} }} />
    </KeyboardAvoidingView>
  </SafeAreaView></SafeAreaProvider>;
}
function App() {
  return <OmgProvider><Fixture /></OmgProvider>;
}
registerRootComponent(App);
