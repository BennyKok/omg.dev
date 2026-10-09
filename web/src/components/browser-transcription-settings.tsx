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
    <p className="text-xs text-muted-foreground">Auto uses cloud until Whistle is ready, then switches between recordings. Local transcribes after you stop. This setting applies to this browser.</p>
    <div className="flex items-center justify-between gap-4">
      <label htmlFor="browser-transcription-language" className="text-sm">Dictation language</label>
      <select id="browser-transcription-language" className="rounded-md border border-border bg-background p-2 text-sm" value={state.language} onChange={(event) => service.configure({ language: event.target.value as TranscriptionLanguage })}>
        <option value="auto">Detect (seven languages)</option>
        <option value="en">English</option><option value="de">German</option><option value="fr">French</option><option value="es">Spanish</option><option value="it">Italian</option><option value="nl">Dutch</option><option value="pl">Polish</option>
        <option value="zh">Chinese (cloud)</option><option value="yue">Cantonese (cloud)</option>
      </select>
    </div>
    <p role="status" className="text-xs text-muted-foreground">
      {state.mode === "cloud" ? "Cloud transcription selected." : !localLanguageSupported(state.language) ? "This language requires cloud transcription. Select Auto or Cloud." : state.status === "ready" ? "Whistle is ready. Audio stays in this browser during local transcription." : state.status === "downloading" ? `Downloading Whistle · ${state.progress}% · 16.9 MB model` : state.status === "loading" ? "Loading Whistle…" : state.status === "error" ? (state.mode === "auto" ? "Whistle is unavailable. Auto uses cloud transcription." : "Whistle is unavailable. Retry or select Cloud.") : "Preparing on-device transcription…"}
    </p>
    {state.mode === "auto" && <p className="text-xs text-muted-foreground">If local transcription fails, Auto sends the recording to cloud transcription.</p>}
    {state.status === "error" && state.mode !== "cloud" && <div className="text-xs"><p>{state.error}</p><button type="button" className="mt-2 underline" onClick={() => service.prepare()}>Retry download</button></div>}
  </div>;
}
