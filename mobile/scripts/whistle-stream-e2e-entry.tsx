/** Real native streaming with a labelled audio fixture; no network STT. */
import { registerRootComponent } from "expo";
import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { SafeAreaView, View, Pressable, TextInput } from "react-native";
import { useRef, useState } from "react";
import { InlineVoiceRecorder } from "../src/components";
import { VoiceInputField } from "../src/omg/voice-input-field";
import { Text } from "../src/omg/text";
import { nativeTranscription } from "../src/omg/native-transcription";
import { LocalDictationStream } from "../src/omg/local-dictation-stream";
import { useTheme } from "../src/omg/theme";
function App() {
  const { colors } = useTheme();
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [status, setStatus] = useState("Ready to test");
  const [committed, setCommitted] = useState("");
  const [partial, setPartial] = useState("");
  const stream = useRef<LocalDictationStream | null>(null);
  const generation = useRef(0);
  async function start() {
    const gen = ++generation.current;
    setStatus("Loading native model…"); setCommitted(""); setPartial("");
    try {
      await nativeTranscription.setPreferences("local", "en"); await nativeTranscription.ensureLoaded();
      const native = await nativeTranscription.openStream(await nativeTranscription.captureTake());
      if (!native) throw Error("Native streaming is unavailable");
      const current = new LocalDictationStream(native, (text, tail) => {
        if (generation.current !== gen) return;
        setCommitted(text); setPartial(tail);
        if (text || tail) setStatus("Live native words");
      });
      stream.current = current; setState("recording");
      const asset = Asset.fromModule(require("../e2e/fixtures/whistle-jfk.wav")); await asset.downloadAsync();
      const wav = await new File(asset.localUri!).bytes();
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      let offset = 12;
      while (offset + 8 <= wav.length && String.fromCharCode(...wav.slice(offset, offset + 4)) !== "data") {
        const size = view.getUint32(offset + 4, true); offset += 8 + size + (size & 1);
      }
      const pcm = wav.slice(offset + 8, offset + 8 + view.getUint32(offset + 4, true));
      for (let i = 0; i < pcm.length && generation.current === gen && stream.current === current; i += 32_000) {
        current.push(pcm.slice(i, i + 32_000));
        await new Promise(resolve => setTimeout(resolve, 1_000));
      }
    } catch (error) { setStatus(`Failed: ${String(error)}`); setState("idle"); }
  }
  async function finish(cancel: boolean) {
    const current = stream.current; if (!current) return;
    stream.current = null; setState("transcribing");
    if (cancel) generation.current++;
    try {
      const text = cancel ? await current.cancel() : await current.finish();
      setStatus(cancel ? "Stream cancelled" : `Final native words: ${text}`);
    } catch (error) { setStatus(`Failed: ${String(error)}`); }
    setCommitted(""); setPartial(""); setState("idle");
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
    <Text style={{ padding: 24, color: colors.text }}>Whistle streaming audio fixture</Text>
    <Text style={{ padding: 24, color: colors.text }}>{status}</Text>
    <View style={{ margin: 20, padding: 14, borderRadius: 24, backgroundColor: colors.card }}>
      <VoiceInputField draft="" dictation={{ state, committed, partial }}>
        <TextInput placeholder="Test transcript" style={{ flex: 1, color: colors.text }} />
      </VoiceInputField>
      <View style={{ marginTop: 14, alignItems: "flex-end" }}>
        {state === "idle" ? <Pressable accessibilityRole="button" onPress={() => void start()}><Text style={{ color: colors.text }}>Stream test clip</Text></Pressable>
          : <InlineVoiceRecorder state={state} level={0.5} onCancel={() => void finish(true)} onConfirm={() => void finish(false)} />}
      </View>
    </View>
  </SafeAreaView>;
}
registerRootComponent(App);
