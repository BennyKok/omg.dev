import { useSyncExternalStore } from "react";

import { createServerBackedPref } from "./server-backed-pref";

// Which folders the desktop folder menu lists, and in what order.
//
// The box owns this (GlobalSettings.folderOrder / hiddenFolders), so the web
// and the iOS folder rail show the same arrangement. App connects the store
// to /api/settings once the box answers; see server-backed-pref.ts. Hiding a
// folder here is a reading preference, not a change to the machine's folder
// list. Removing a folder from the machine is a different action
// (DELETE /api/repos) and the menu offers it separately.

export type FolderMenuPrefs = {
  /** Project keys in the order the user put them. Unknown keys are ignored. */
  order: string[];
  /** Project keys the menu leaves out. */
  hidden: string[];
};

const DEFAULTS: FolderMenuPrefs = { order: [], hidden: [] };

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export const folderMenuPrefsStore = createServerBackedPref<FolderMenuPrefs>({
  storageKey: "lfg_folder_menu",
  defaults: DEFAULTS,
  parse: (raw) => {
    const parsed = (raw ?? {}) as Partial<FolderMenuPrefs>;
    return { order: strings(parsed.order), hidden: strings(parsed.hidden) };
  },
});

export function getFolderMenuPrefs(): FolderMenuPrefs {
  return folderMenuPrefsStore.get();
}

export function setFolderMenuOrder(order: string[]): void {
  folderMenuPrefsStore.set({ ...getFolderMenuPrefs(), order: [...order] });
}

export function setFolderMenuHidden(project: string, hidden: boolean): void {
  const current = getFolderMenuPrefs();
  const rest = current.hidden.filter((key) => key !== project);
  folderMenuPrefsStore.set({ ...current, hidden: hidden ? [...rest, project] : rest });
}

export function subscribeFolderMenuPrefs(listener: () => void): () => void {
  return folderMenuPrefsStore.subscribe(listener);
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
