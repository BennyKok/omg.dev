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

/** "#/play?mode=daily" -> { mode: "daily" }. */
export function paramsFromHash(hash: string): URLSearchParams {
  const i = hash.indexOf("?");
  return new URLSearchParams(i < 0 ? "" : hash.slice(i + 1));
}

const current = () => routeFromHash(location.hash);
const currentHash = () => location.hash;

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

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The screen path, such as "/play". */
export function useRoute(): string {
  return useSyncExternalStore(subscribe, current, () => "/");
}

/** The whole hash with its query ("#/play?mode=daily"). A new value remounts the screen. */
export function useRouteKey(): string {
  return useSyncExternalStore(subscribe, currentHash, () => "");
}

/** Query of the current screen: `useRouteParams().get("mode")`. */
export function useRouteParams(): URLSearchParams {
  return paramsFromHash(useRouteKey());
}
