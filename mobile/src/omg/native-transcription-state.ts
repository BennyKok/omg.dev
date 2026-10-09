export type TranscriptionMode = "auto" | "cloud" | "local";
export type TranscriptionLanguage = "auto" | "en" | "de" | "fr" | "es" | "it" | "nl" | "pl" | "zh" | "yue";
export interface NativeTranscriptionEngine {
  prepare(): Promise<void>;
  transcribe(uri: string, language: string): Promise<string>;
}
export interface NativeTranscriptionState {
  mode: TranscriptionMode;
  language: TranscriptionLanguage;
  status: "idle" | "downloading" | "ready" | "error";
  hydrated: boolean;
  available: boolean;
}
export interface DictationTake {
  provider: "cloud" | "local";
  mode: TranscriptionMode;
  language: TranscriptionLanguage;
}
const KEY = "omg:native-transcription-v1";
const languages = ["auto", "en", "de", "fr", "es", "it", "nl", "pl", "zh", "yue"];
export const supportsLocalLanguage = (language: string) => language !== "zh" && language !== "yue";

/** One owner for native preferences, model readiness, and recording selection. */
export class NativeTranscription {
  private state: NativeTranscriptionState;
  private listeners = new Set<() => void>();
  private initialization: Promise<void> | null = null;
  private loading: Promise<void> | null = null;
  private writes = Promise.resolve();
  constructor(private engine: NativeTranscriptionEngine | null, private storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<unknown>;
  }) {
    this.state = { mode: "auto", language: "auto", status: "idle", hydrated: false, available: !!engine };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(next: Partial<NativeTranscriptionState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  initialize() {
    return this.initialization ??= (async () => {
      try {
        const saved = JSON.parse(await this.storage.getItem(KEY) || "null");
        if (saved && ["auto", "cloud", "local"].includes(saved.mode) && languages.includes(saved.language)) {
          this.update({ mode: saved.mode, language: saved.language });
        }
      } catch { /* Missing or invalid preferences use Auto. */ }
      this.update({ hydrated: true });
      void this.ensureLoaded();
    })();
  }
  async setPreferences(mode: TranscriptionMode, language = this.state.language) {
    await this.initialize();
    this.update({ mode, language });
    const saved = JSON.stringify({ mode, language });
    this.writes = this.writes.then(() => this.storage.setItem(KEY, saved)).then(() => {}, () => {});
    void this.ensureLoaded();
    await this.writes;
  }
  ensureLoaded() {
    if (!this.state.hydrated || this.state.mode === "cloud" || !supportsLocalLanguage(this.state.language)) return Promise.resolve();
    if (!this.engine) { this.update({ status: "error" }); return Promise.resolve(); }
    if (this.loading || this.state.status === "ready") return this.loading ?? Promise.resolve();
    this.update({ status: "downloading" });
    this.loading = this.engine.prepare().then(() => this.update({ status: "ready" }), () => this.update({ status: "error" }))
      .finally(() => { this.loading = null; });
    return this.loading;
  }
  async captureTake(): Promise<DictationTake> {
    await this.initialize();
    const { mode, language, status } = this.state;
    const local = status === "ready" && supportsLocalLanguage(language);
    if (mode === "local" && !local) throw new Error(supportsLocalLanguage(language) ? "On-device transcription is not ready" : "This language needs cloud");
    return { provider: mode !== "cloud" && local ? "local" : "cloud", mode, language };
  }
  async transcribe(uri: string, take: DictationTake): Promise<string> {
    if (!this.engine || take.provider !== "local") throw new Error("On-device transcription is unavailable");
    return this.engine.transcribe(uri, take.language);
  }
}

/** Forced Local never sends audio to cloud, including when native inference fails. */
export async function finishLocalTake(service: NativeTranscription, uri: string, take: DictationTake,
  replay: () => Promise<string>, cancelled: () => boolean): Promise<string> {
  if (cancelled()) return "";
  try {
    const text = await service.transcribe(uri, take);
    return cancelled() ? "" : text;
  } catch (error) {
    if (cancelled()) return "";
    if (take.mode !== "auto") throw error;
    const text = await replay();
    return cancelled() ? "" : text;
  }
}
