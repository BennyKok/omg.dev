/** Simulator audio fixture. Settings and inference use the production native service. */
import { registerRootComponent } from "expo";
import { Asset } from "expo-asset";
import { SafeAreaView, ScrollView, Pressable, Text } from "react-native";
import { useState } from "react";
import { NativeTranscriptionSettings } from "../src/omg/native-transcription-settings";
import { nativeTranscription } from "../src/omg/native-transcription";
import { finishLocalTake } from "../src/omg/native-transcription-state";
import { useTheme } from "../src/omg/theme";

function App() {
  const { colors } = useTheme();
  const [result, setResult] = useState("Ready to test");
  async function transcribe() {
    setResult("Transcribing test clip…");
    try {
      const asset = Asset.fromModule(require("../e2e/fixtures/whistle-jfk.wav"));
      await asset.downloadAsync();
      const take = await nativeTranscription.captureTake();
      if (take.provider !== "local") throw Error("Select Local after the model is ready");
      const text = await finishLocalTake(nativeTranscription, asset.localUri!, take,
        async () => { throw Error("Cloud is disabled in this fixture"); }, () => false);
      if (!text.toLowerCase().includes("country")) throw Error(`Unexpected transcript: ${text}`);
      setResult(`Native speech verified\n${text}`);
    } catch (error) { setResult(`Failed: ${String(error)}`); }
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><ScrollView contentContainerStyle={{ padding: 16 }}>
    <Text style={{ fontSize: 20, marginBottom: 16, color: colors.text }}>Whistle iOS audio fixture</Text>
    <NativeTranscriptionSettings />
    <Pressable accessibilityRole="button" onPress={() => void transcribe()} style={{ padding: 16 }}><Text style={{ color: colors.text }}>Transcribe test clip</Text></Pressable>
    <Text accessibilityLiveRegion="polite" style={{ padding: 16, color: colors.text }}>{result}</Text>
  </ScrollView></SafeAreaView>;
}
registerRootComponent(App);
