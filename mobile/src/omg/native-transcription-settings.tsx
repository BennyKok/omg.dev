import { Alert, Pressable, View } from "react-native";
import { Card, SectionLabel } from "../components";
import { Text } from "./text";
import { useTheme } from "./theme";
import { nativeTranscription, useNativeTranscription } from "./native-transcription";
import { supportsLocalLanguage, type TranscriptionLanguage, type TranscriptionMode } from "./native-transcription-state";

const languages: [TranscriptionLanguage, string][] = [["auto", "Auto detect"], ["en", "English"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["it", "Italian"], ["nl", "Dutch"], ["pl", "Polish"], ["zh", "Chinese (cloud)"], ["yue", "Cantonese (cloud)"]];
export function NativeTranscriptionSettings() {
  const state = useNativeTranscription();
  const { colors } = useTheme();
  const status = state.mode === "cloud" ? "Cloud transcription"
    : !supportsLocalLanguage(state.language) ? "This language needs cloud"
    : !state.available ? "Local needs an app update"
    : state.status === "ready" ? "On-device ready · text after recording"
    : state.status === "downloading" ? "Downloading model…" : state.status === "error" ? "Local unavailable" : "Preparing model…";
  return <>
    <SectionLabel>Audio</SectionLabel>
    <Card>
      <View style={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["auto", "cloud", "local"] as TranscriptionMode[]).map(mode => <Pressable key={mode}
            testID={`transcription-${mode}`} accessibilityRole="button" accessibilityState={{ selected: state.mode === mode, disabled: !state.hydrated }}
            disabled={!state.hydrated} onPress={() => void nativeTranscription.setPreferences(mode)}
            style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: state.mode === mode ? colors.primary : colors.bg }}>
            <Text style={{ color: state.mode === mode ? colors.primaryForeground : colors.text, textAlign: "center" }}>{mode[0].toUpperCase() + mode.slice(1)}</Text>
          </Pressable>)}
        </View>
        <Pressable testID="transcription-language" accessibilityRole="button" disabled={!state.hydrated}
          onPress={() => Alert.alert("Language", undefined, [...languages.map(([language, text]) => ({ text,
            onPress: () => void nativeTranscription.setPreferences(state.mode, language) })), { text: "Cancel", style: "cancel" }])}>
          <Text style={{ color: colors.text }}>Language · {languages.find(([language]) => language === state.language)?.[1]}</Text>
        </Pressable>
        <Text style={{ color: colors.textMuted, fontSize: 13 }} accessibilityLiveRegion="polite">{status}</Text>
        {state.available && state.status === "error" && state.mode !== "cloud" && <Pressable onPress={() => void nativeTranscription.ensureLoaded()}><Text style={{ color: colors.accent }}>Retry</Text></Pressable>}
      </View>
    </Card>
  </>;
}
