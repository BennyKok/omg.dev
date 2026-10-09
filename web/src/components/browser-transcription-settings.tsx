import { useEffect, useSyncExternalStore } from "react";
import { browserTranscription, localLanguageSupported, type BrowserTranscription, type TranscriptionLanguage, type TranscriptionMode } from "../lib/browser-transcription";

export function useBrowserTranscription() {
  const state = useSyncExternalStore(browserTranscription.subscribe, browserTranscription.getSnapshot);
  useEffect(() => { if (state.mode !== "cloud" && state.status === "idle") browserTranscription.prepare(); }, [state.mode, state.status]);
  return state;
}
export function BrowserTranscriptionSettings({ service = browserTranscription }: { service?: BrowserTranscription }) {
  const state = useSyncExternalStore(service.subscribe, service.getSnapshot);
  useEffect(() => { if (state.mode !== "cloud" && state.status === "idle") service.prepare(); }, [service, state.mode, state.status]);
  return <div className="space-y-3 px-4 py-3">
    <div className="flex items-center justify-between gap-4">
      <label htmlFor="browser-transcription-mode" className="text-sm font-medium">Transcription</label>
      <select id="browser-transcription-mode" className="rounded-md border border-border bg-background p-2 text-sm" value={state.mode} onChange={(event) => service.configure({ mode: event.target.value as TranscriptionMode })}>
        <option value="auto">Auto</option><option value="cloud">Cloud</option><option value="local">Local</option>
      </select>
    </div>
    <div className="flex items-center justify-between gap-4">
      <label htmlFor="browser-transcription-language" className="text-sm">Language</label>
      <select id="browser-transcription-language" className="rounded-md border border-border bg-background p-2 text-sm" value={state.language} onChange={(event) => service.configure({ language: event.target.value as TranscriptionLanguage })}>
        <option value="auto">Auto detect</option>
        <option value="en">English</option><option value="de">German</option><option value="fr">French</option><option value="es">Spanish</option><option value="it">Italian</option><option value="nl">Dutch</option><option value="pl">Polish</option>
        <option value="zh">Chinese (cloud)</option><option value="yue">Cantonese (cloud)</option>
      </select>
    </div>
    <p role="status" className="text-xs text-muted-foreground">
      {state.mode === "cloud" ? "Cloud transcription" : !localLanguageSupported(state.language) ? "This language needs cloud" : state.status === "ready" ? (state.mode === "auto" ? "On-device ready · cloud fallback" : "On-device ready · audio stays here") : state.status === "downloading" ? `Downloading · ${state.progress}%${state.mode === "auto" ? " · using cloud" : ""}` : state.status === "loading" ? "Loading on-device model…" : state.status === "error" ? (state.mode === "auto" ? "Using cloud · local unavailable" : "Local unavailable · retry or use Cloud") : "Preparing on-device model…"}
    </p>
    {state.status === "error" && state.mode !== "cloud" && <div className="text-xs"><button type="button" className="underline" onClick={() => service.prepare()}>Retry</button></div>}
  </div>;
}
