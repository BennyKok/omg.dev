import { useEffect, useSyncExternalStore } from "react";
import { AudioLines, Languages } from "lucide-react";
import { SettingsIcon, SettingsRow, SettingsSelect } from "./settings-ui";
import { browserTranscription, localLanguageSupported, type BrowserTranscription, type TranscriptionLanguage, type TranscriptionMode } from "../lib/browser-transcription";

export function useBrowserTranscription() {
  const state = useSyncExternalStore(browserTranscription.subscribe, browserTranscription.getSnapshot);
  useEffect(() => { if (state.mode !== "cloud" && state.status === "idle") browserTranscription.prepare(); }, [state.mode, state.status]);
  return state;
}
/**
 * The dictation mode for this browser, for a host that renders its own
 * settings row. It reads and writes the same store the composer reads at the
 * start of every take, so a change applies to the next recording.
 */
export function useTranscriptionMode(service: BrowserTranscription = browserTranscription) {
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  useEffect(() => { if (state.mode !== "cloud" && state.status === "idle") service.prepare(); }, [service, state.mode, state.status]);
  return {
    mode: state.mode,
    status: state.status,
    progress: state.progress,
    localSupported: localLanguageSupported(state.language),
    setMode: (mode: TranscriptionMode) => service.configure({ mode }),
    retry: () => service.prepare(),
  };
}
/** Two Settings rows; the caller owns the card. */
export function BrowserTranscriptionSettings({ service = browserTranscription }: { service?: BrowserTranscription }) {
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  useEffect(() => { if (state.mode !== "cloud" && state.status === "idle") service.prepare(); }, [service, state.mode, state.status]);
  const status = state.mode === "cloud" ? "Cloud transcription" : !localLanguageSupported(state.language) ? "This language needs cloud" : state.status === "ready" ? (state.mode === "auto" ? "On-device ready · cloud fallback" : "On-device ready · audio stays here") : state.status === "downloading" ? `Downloading · ${state.progress}%${state.mode === "auto" ? " · using cloud" : ""}` : state.status === "loading" ? "Loading on-device model…" : state.status === "error" ? (state.mode === "auto" ? "Using cloud · local unavailable" : "Local unavailable · retry or use Cloud") : "Preparing on-device model…";
  return <>
    <SettingsRow
      icon={<SettingsIcon><AudioLines /></SettingsIcon>}
      title="Transcription"
      description={<span role="status">
        {status}
        {state.status === "error" && state.mode !== "cloud" ? <> · <button type="button" className="underline" onClick={() => service.prepare()}>Retry</button></> : null}
      </span>}
      trailing={<SettingsSelect id="browser-transcription-mode" aria-label="Transcription" value={state.mode} onChange={(value) => service.configure({ mode: value as TranscriptionMode })}>
        <option value="cloud">Cloud</option><option value="auto">Auto</option><option value="local">Local</option>
      </SettingsSelect>}
    />
    <SettingsRow
      icon={<SettingsIcon><Languages /></SettingsIcon>}
      title="Language"
      trailing={<SettingsSelect id="browser-transcription-language" aria-label="Language" value={state.language} onChange={(value) => service.configure({ language: value as TranscriptionLanguage })}>
        <option value="auto">Auto detect</option>
        <option value="en">English</option><option value="de">German</option><option value="fr">French</option><option value="es">Spanish</option><option value="it">Italian</option><option value="nl">Dutch</option><option value="pl">Polish</option>
        <option value="zh">Chinese (cloud)</option><option value="yue">Cantonese (cloud)</option>
      </SettingsSelect>}
    />
  </>;
}
