// Screens by URL hash ("#/play"), with the same calls as the Expo kit:
// router.push("/play"), router.replace("/results"), router.back().
// Hash routes work on any static host and in a Home Screen web app, and a
// reload stays on the same screen. The screen list is in src/app/routes.tsx.
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
/** Screens pushed in this page load. `back()` never leaves the game. */
let depth = 0;

/** "#/play?x=1" -> "/play". Anything else -> "/". */
export function routeFromHash(hash: string): string {
  const path = hash.replace(/^#/, "").split("?")[0];
  return path.startsWith("/") ? path.replace(/\/+$/, "") || "/" : "/";
}

const current = () => routeFromHash(location.hash);

if (typeof window !== "undefined") window.addEventListener("hashchange", emit);

export const router = {
  push(path: string): void {
    depth++;
    location.hash = path;
  },
  replace(path: string): void {
    history.replaceState(history.state, "", `#${path}`);
    emit();
  },
  back(): void {
    if (depth > 0) {
      depth--;
      history.back();
    } else {
      router.replace("/");
    }
  },
};

export function useRoute(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    current,
    () => "/",
  );
}
