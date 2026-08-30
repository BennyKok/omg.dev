export const TIBO_MODE_STORAGE_KEY = "omg_tibo_mode";

type StorageReader = { getItem(key: string): string | null };
type StorageWriter = { setItem(key: string, value: string): void };

export function modelSupportsTiboMode(model: string | null | undefined): boolean {
  if (!model) return false;
  return /^gpt-5\.(?:6(?:-|$)|5(?:-|$)|4$)/.test(model);
}

export function canUseTiboMode(input: {
  agent: string;
  model?: string | null;
  thinkingLevels: readonly string[];
}): boolean {
  return (
    (input.agent === "codex" || input.agent === "codex-aisdk") &&
    modelSupportsTiboMode(input.model) &&
    input.thinkingLevels.includes("high")
  );
}

export function readTiboMode(storage: StorageReader): boolean {
  return storage.getItem(TIBO_MODE_STORAGE_KEY) === "on";
}

export function writeTiboMode(storage: StorageWriter, enabled: boolean): void {
  storage.setItem(TIBO_MODE_STORAGE_KEY, enabled ? "on" : "off");
}

export function resolveTiboLaunch<T extends string>(input: {
  enabled: boolean;
  available: boolean;
  model: string;
  thinkingLevel: T;
}): {
  model: string;
  thinkingLevel: T | "high";
  fastMode?: true;
} {
  if (!input.enabled || !input.available) {
    return { model: input.model, thinkingLevel: input.thinkingLevel };
  }
  return {
    model: input.model,
    thinkingLevel: "high",
    fastMode: true,
  };
}
