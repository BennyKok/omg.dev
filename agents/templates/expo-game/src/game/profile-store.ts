// Saved profile on the phone (AsyncStorage; localStorage on the web). One
// store for settings, best scores, unlocks and the last run. Screens read it
// with `useProfile()`; the game writes with `profileStore.finishRun(...)`.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { emptyProfile, migrateProfile, recordRun, type Profile, type RunResult, type Settings, type Unlock } from "./progress";

const KEY = "__OMG_PROJECT_SLUG__:profile";

let profile: Profile = emptyProfile();
let loaded = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

async function save(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // Storage full or blocked: the game keeps playing with in-memory progress.
  }
}

const ready: Promise<void> = (async () => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    profile = migrateProfile(raw ? JSON.parse(raw) : null);
  } catch {
    profile = emptyProfile();
  }
  loaded = true;
  emit();
})();

export const profileStore = {
  ready,
  get: (): Profile => profile,
  isLoaded: (): boolean => loaded,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  update(fn: (p: Profile) => Profile): void {
    profile = fn(profile);
    emit();
    void save();
  },
  setSettings(patch: Partial<Settings>): void {
    profileStore.update((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  },
  select(group: string, id: string): void {
    profileStore.update((p) => ({ ...p, selected: { ...p.selected, [group]: id } }));
  },
  finishRun(run: RunResult, unlocks: readonly Unlock[]): void {
    profileStore.update((p) => recordRun(p, run, unlocks));
  },
  reset(): void {
    profileStore.update(() => emptyProfile());
  },
};

export function useProfile(): Profile {
  return useSyncExternalStore(profileStore.subscribe, profileStore.get, profileStore.get);
}
