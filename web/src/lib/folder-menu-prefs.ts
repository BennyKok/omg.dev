import { useSyncExternalStore } from "react";

// Which folders the desktop folder menu lists, and in what order.
//
// The web copy of the iOS folder rail arrangement (mobile/src/omg/
// folder-rail-sheet.tsx, STORAGE_KEYS.folderRail). Like iOS, it lives on this
// device only: hiding a folder here is a reading preference, not a change to
// the machine's folder list. Removing a folder from the machine is a
// different action (DELETE /api/repos) and the menu offers it separately.

export type FolderMenuPrefs = {
  /** Project keys in the order the user put them. Unknown keys are ignored. */
  order: string[];
  /** Project keys the menu leaves out. */
  hidden: string[];
};

const STORAGE_KEY = "lfg_folder_menu";
const DEFAULTS: FolderMenuPrefs = { order: [], hidden: [] };

let cache: FolderMenuPrefs | null = null;
const listeners = new Set<() => void>();

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function read(): FolderMenuPrefs {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<FolderMenuPrefs>;
    return { order: strings(parsed.order), hidden: strings(parsed.hidden) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getFolderMenuPrefs(): FolderMenuPrefs {
  if (!cache) cache = read();
  return cache;
}

function write(next: FolderMenuPrefs): void {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  for (const listener of listeners) listener();
}

export function setFolderMenuOrder(order: string[]): void {
  write({ ...getFolderMenuPrefs(), order: [...order] });
}

export function setFolderMenuHidden(project: string, hidden: boolean): void {
  const current = getFolderMenuPrefs();
  const rest = current.hidden.filter((key) => key !== project);
  write({ ...current, hidden: hidden ? [...rest, project] : rest });
}

export function subscribeFolderMenuPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFolderMenuPrefs(): FolderMenuPrefs {
  return useSyncExternalStore(subscribeFolderMenuPrefs, getFolderMenuPrefs, getFolderMenuPrefs);
}

export type ArrangedFolder = { value: string; hidden: boolean };

/**
 * The folders in the user's order, each marked hidden or shown.
 *
 * Folders the user has placed come first, in that order. Folders that
 * appeared since keep the order the caller gave them and follow. A saved key
 * with no folder behind it any more is dropped, so a removed folder does not
 * hold a slot.
 */
export function arrangeFolders(
  folders: readonly string[],
  prefs: FolderMenuPrefs,
): ArrangedFolder[] {
  const present = new Set(folders);
  const hidden = new Set(prefs.hidden);
  const placed = prefs.order.filter((key, index) => present.has(key) && prefs.order.indexOf(key) === index);
  const placedSet = new Set(placed);
  return [...placed, ...folders.filter((key) => !placedSet.has(key))].map((value) => ({
    value,
    hidden: hidden.has(value),
  }));
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    cache = read();
    for (const listener of listeners) listener();
  });
}
