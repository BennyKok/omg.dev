export type TranscriptionMode = "auto" | "cloud" | "local";
export type TranscriptionLanguage = "auto" | "en" | "de" | "fr" | "es" | "it" | "nl" | "pl" | "zh" | "yue";
export type BrowserTranscriptionState = {
  mode: TranscriptionMode;
  language: TranscriptionLanguage;
  status: "idle" | "downloading" | "loading" | "ready" | "error";
  progress: number;
  error: string | null;
};
export type TranscriptionTake = { provider: "cloud" | "local"; mode: TranscriptionMode; language: TranscriptionLanguage };
const KEY = "omg-browser-transcription-v1";
const LOCAL_LANGUAGES = new Set(["auto", "en", "de", "fr", "es", "it", "nl", "pl"]);
export function localLanguageSupported(language: string) { return LOCAL_LANGUAGES.has(language); }
export function selectTranscriptionTake(state: BrowserTranscriptionState): TranscriptionTake {
  const local = state.status === "ready" && localLanguageSupported(state.language);
  if (state.mode === "local" && !local) {
    throw new Error(!localLanguageSupported(state.language) ? "This language needs cloud transcription. Select Auto or Cloud." : "On-device transcription is not ready. Wait for the download or select Cloud.");
  }
  return { provider: state.mode !== "cloud" && local ? "local" : "cloud", mode: state.mode, language: state.language };
}

type Pending = { resolve: (text: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export class BrowserTranscription {
  private state: BrowserTranscriptionState = { mode: "auto", language: "auto", status: "idle", progress: 0, error: null };
  private listeners = new Set<() => void>();
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private loadTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private createWorker = () => new Worker(new URL("./whistle.worker.ts", import.meta.url), { type: "module" })) {
    try {
      const saved = JSON.parse(window.localStorage.getItem(KEY) || "null");
      if (["auto", "cloud", "local"].includes(saved?.mode)) this.state.mode = saved.mode;
      if (LOCAL_LANGUAGES.has(saved?.language) || ["zh", "yue"].includes(saved?.language)) this.state.language = saved.language;
    } catch { /* Storage can be blocked. Defaults still work. */ }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<BrowserTranscriptionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  configure(patch: Partial<Pick<BrowserTranscriptionState, "mode" | "language">>) {
    this.update(patch);
    try { window.localStorage.setItem(KEY, JSON.stringify({ mode: this.state.mode, language: this.state.language })); } catch { /* Optional persistence. */ }
    if (this.state.mode !== "cloud") this.prepare();
  }
  prepare() {
    if (this.worker || this.state.mode === "cloud") return;
    this.update({ status: "downloading", progress: 0, error: null });
    try {
      this.worker = this.createWorker();
      this.worker.onmessage = ({ data }) => {
        if (data.type === "progress") this.update({ progress: data.progress });
        else if (data.type === "loading") this.update({ status: "loading", progress: 100 });
        else if (data.type === "ready") {
          if (this.loadTimer) clearTimeout(this.loadTimer);
          this.loadTimer = null;
          this.update({ status: "ready", progress: 100 });
        } else if (data.id != null) {
          const request = this.pending.get(data.id);
          if (!request) return;
          clearTimeout(request.timer);
          this.pending.delete(data.id);
          if (data.type === "result") request.resolve(data.text);
          else this.fail(data.error || "On-device transcription failed");
          // fail rejects other queued calls; this call was already removed.
          if (data.type !== "result") request.reject(new Error(data.error || "On-device transcription failed"));
        } else if (data.type === "error") this.fail(data.error);
      };
      this.worker.onerror = () => this.fail("Could not load on-device transcription");
      this.loadTimer = setTimeout(() => this.fail("Model download timed out. Select Retry or Cloud."), 180000);
      this.worker.postMessage({ type: "load" });
    } catch (error) { this.fail(String(error)); }
  }
  private fail(message: string) {
    this.worker?.terminate();
    this.worker = null;
    if (this.loadTimer) clearTimeout(this.loadTimer);
    this.loadTimer = null;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
    this.pending.clear();
    this.update({ status: "error", error: message });
  }
  transcribe(samples: Float32Array, take: TranscriptionTake): Promise<string> {
    if (this.state.status !== "ready" || !this.worker) return Promise.reject(new Error("On-device transcription is unavailable"));
    const id = ++this.nextId;
    const copy = samples.slice();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail("On-device transcription timed out"), 45000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker!.postMessage({ type: "transcribe", id, samples: copy.buffer, language: take.language }, [copy.buffer]); }
      catch (error) { this.fail(String(error)); }
    });
  }
}
export const browserTranscription = new BrowserTranscription();
