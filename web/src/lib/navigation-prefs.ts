import { useSyncExternalStore } from "react";

// Browser-local navigation preferences. Kept separate from sound/haptics so a
// gesture setting cannot accidentally become part of feedback behavior.

export type NavigationPrefs = {
  swipeBetweenChats: boolean;
};

const STORAGE_KEY = "lfg_navigation";
const DEFAULTS: NavigationPrefs = { swipeBetweenChats: true };

let cache: NavigationPrefs | null = null;
const listeners = new Set<(prefs: NavigationPrefs) => void>();

export function parseNavigationPrefs(raw: string | null): NavigationPrefs {
  if (!raw) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(raw) as Partial<NavigationPrefs>;
    return {
      swipeBetweenChats: parsed.swipeBetweenChats ?? DEFAULTS.swipeBetweenChats,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function read(): NavigationPrefs {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    return parseNavigationPrefs(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULTS };
  }
}

export function getNavigationPrefs(): NavigationPrefs {
  if (!cache) cache = read();
  return cache;
}

export function setNavigationPrefs(patch: Partial<NavigationPrefs>): void {
  const next = { ...getNavigationPrefs(), ...patch };
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  for (const listener of listeners) listener(next);
}

export function subscribeNavigationPrefs(
  listener: (prefs: NavigationPrefs) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNavigationPrefs(): NavigationPrefs {
  return useSyncExternalStore(
    subscribeNavigationPrefs,
    getNavigationPrefs,
    getNavigationPrefs,
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    cache = read();
    for (const listener of listeners) listener(cache);
  });
}
