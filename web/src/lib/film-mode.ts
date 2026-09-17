import { useSyncExternalStore } from "react";

// Browser-local "film mode": blur every session title, preview, message and
// terminal so the screen can be filmed without leaking what the agents are
// working on. Pure presentation — nothing leaves the browser, and the server
// never learns the switch exists. The class lives on <html> so plain CSS does
// the blurring and no component has to re-render for it.

const STORAGE_KEY = "lfg_film_mode";
const HTML_CLASS = "lfg-film";

let cache: boolean | null = null;
const listeners = new Set<(on: boolean) => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function paint(on: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(HTML_CLASS, on);
}

export function getFilmMode(): boolean {
  if (cache === null) cache = read();
  return cache;
}

export function setFilmMode(on: boolean): void {
  cache = on;
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
  paint(on);
  for (const listener of listeners) listener(on);
}

export function subscribeFilmMode(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFilmMode(): boolean {
  return useSyncExternalStore(subscribeFilmMode, getFilmMode, getFilmMode);
}

if (typeof window !== "undefined") {
  paint(getFilmMode());
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    cache = read();
    paint(cache);
    for (const listener of listeners) listener(cache);
  });
}
