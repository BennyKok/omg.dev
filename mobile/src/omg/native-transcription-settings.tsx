import { View } from "react-native";
import { useState, type ReactNode } from "react";
import { Card, GROUPED_INSET, Icon, Row, SectionLabel, Separator, SettingsIcon } from "../components";
import { DropdownMenu, type MenuOption } from "./menu";
import { Text } from "./text";
import { useTheme } from "./theme";
import { nativeTranscription, useNativeTranscription } from "./native-transcription";
import { supportsLocalLanguage, type TranscriptionLanguage, type TranscriptionMode } from "./native-transcription-state";

const languages: [TranscriptionLanguage, string][] = [["auto", "Auto detect"], ["en", "English"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["it", "Italian"], ["nl", "Dutch"], ["pl", "Polish"], ["zh", "Chinese (cloud)"], ["yue", "Cantonese (cloud)"]];
const modes: [TranscriptionMode, string][] = [["auto", "Auto"], ["cloud", "Cloud"], ["local", "Local"]];

/** The menu host gets the card's actual width, including split-screen layouts. */
function AudioPickerRow({ label, value, icon, options }: {
  label: string; value: string; icon: ReactNode; options: MenuOption[];
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  return <View onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <DropdownMenu title={label} options={options} style={{ width, height: 52 }}>
      <View pointerEvents="none" style={{ width, height: 52 }}>
      <Row icon={icon} onPress={() => { /* The native menu owns the tap. */ }}>
        <Text style={{ flex: 1, fontSize: 17, color: colors.text }} numberOfLines={1}>{label}</Text>
        <Text style={{ fontSize: 17, color: colors.textMuted }} numberOfLines={1}>{value}</Text>
        <Icon ios="chevron.up.chevron.down" android="unfold_more" size={13} color={colors.textMuted} />
      </Row>
      </View>
    </DropdownMenu>
  </View>;
}

export function NativeTranscriptionSettings() {
  const state = useNativeTranscription();
  const { colors, space } = useTheme();
  const status = state.mode === "cloud" ? "Cloud transcription"
    : !supportsLocalLanguage(state.language) ? "This language needs cloud"
    : !state.available ? "Local needs an app update"
    : state.status === "ready" ? nativeTranscription.streamingAvailable ? "On-device ready · live text" : "On-device ready · text after recording"
    : state.status === "downloading" ? "Downloading model…" : state.status === "error" ? "Local unavailable" : "Preparing model…";
  return <>
    <SectionLabel>Audio</SectionLabel>
    <Card>
      <AudioPickerRow label="Transcription" value={modes.find(([mode]) => mode === state.mode)![1]}
        icon={<SettingsIcon tint="#ff453a"><Icon ios="waveform" android="graphic_eq" size={17} color="#ffffff" /></SettingsIcon>}
        options={modes.map(([mode, label]) => ({ id: `transcription-${mode}`, label, selected: state.mode === mode,
          disabled: !state.hydrated, onPress: () => void nativeTranscription.setPreferences(mode) }))} />
      <Separator inset="icon" />
      <AudioPickerRow label="Language" value={languages.find(([language]) => language === state.language)![1]}
        icon={<SettingsIcon tint="#0a84ff"><Icon ios="globe" android="language" size={17} color="#ffffff" /></SettingsIcon>}
        options={languages.map(([language, label]) => ({ label, selected: state.language === language,
          disabled: !state.hydrated, onPress: () => void nativeTranscription.setPreferences(state.mode, language) }))} />
      {state.available && state.status === "error" && state.mode !== "cloud" && <>
        <Separator inset="icon" />
        <Row onPress={() => void nativeTranscription.ensureLoaded()} icon={<SettingsIcon tint="#8e8e93"><Icon ios="arrow.clockwise" android="refresh" size={17} color="#ffffff" /></SettingsIcon>}>
          <Text style={{ fontSize: 17, color: colors.text }}>Retry download</Text>
        </Row>
      </>}
    </Card>
    <Text accessibilityLiveRegion="polite" style={{ marginHorizontal: GROUPED_INSET + 14, marginTop: space.sm, fontSize: 13, color: colors.textMuted }}>{status}</Text>
  </>;
}
