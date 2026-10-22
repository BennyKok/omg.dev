// The saved-profile store without React, so `bun test` can run it with a fake
// storage. Screens use profile-store.ts (`profileStore`, `useProfile`).
import { emptyProfile, migrateProfile, recordRun, type Profile, type RunResult, type Settings, type Unlock } from "../game/progress";

export type ProfileStorage = Pick<Storage, "getItem" | "setItem">;

/** The store with its storage passed in, so tests can use a fake one. */
export function createProfileStore(storage: ProfileStorage | null, key: string) {
  let profile: Profile;
  try {
    const raw = storage?.getItem(key);
    profile = migrateProfile(raw ? JSON.parse(raw) : null);
  } catch {
    profile = emptyProfile();
  }
  const listeners = new Set<() => void>();
  const store = {
    /** Kept for the Expo kit's shape; localStorage loads at once. */
    ready: Promise.resolve(),
    get: (): Profile => profile,
    isLoaded: (): boolean => true,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(fn: (p: Profile) => Profile): void {
      profile = fn(profile);
      try {
        storage?.setItem(key, JSON.stringify(profile));
      } catch {
        // Storage full or blocked (private mode): the game keeps playing with in-memory progress.
      }
      listeners.forEach((l) => l());
    },
    setSettings(patch: Partial<Settings>): void {
      store.update((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
    },
    select(group: string, id: string): void {
      store.update((p) => ({ ...p, selected: { ...p.selected, [group]: id } }));
    },
    finishRun(run: RunResult, unlocks: readonly Unlock[]): void {
      store.update((p) => recordRun(p, run, unlocks));
    },
    reset(): void {
      store.update(() => emptyProfile());
    },
  };
  return store;
}
