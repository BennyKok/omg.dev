// Saved profile in the browser (localStorage). One store for settings, best
// scores, unlocks and the last run. Screens read it with `useProfile()`; the
// game writes with `profileStore.finishRun(...)`. A reload keeps everything.
import { useSyncExternalStore } from "react";
import { createProfileStore, type ProfileStorage } from "./profile-core";
import type { Profile } from "../game/progress";

const KEY = "__OMG_PROJECT_SLUG__:profile";

function browserStorage(): ProfileStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // a blocked storage throws on access
  }
}

export const profileStore = createProfileStore(browserStorage(), KEY);

export function useProfile(): Profile {
  return useSyncExternalStore(profileStore.subscribe, profileStore.get, profileStore.get);
}
