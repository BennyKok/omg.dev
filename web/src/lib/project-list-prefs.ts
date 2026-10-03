import { useSyncExternalStore } from "react";
import { createServerBackedPref } from "./server-backed-pref";

// Display preferences for the Projects picker sheet.
//
// `showPaths` controls whether each row renders its full working directory
// under the project name. Hiding it halves the row height, so roughly twice as
// many projects fit in the sheet without scrolling — which is the default,
// since the folder name is usually enough to pick from. The box owns it
// (GlobalSettings.showProjectPaths) so every client shows the same rows; see
// server-backed-pref.ts. Every mounted copy of the sheet (rail + new-session
// dialog) flips together through the store's subscriber list.

export type ProjectListPrefs = {
  showPaths: boolean;
};

const DEFAULTS: ProjectListPrefs = { showPaths: false };

export const projectListPrefsStore = createServerBackedPref<ProjectListPrefs>({
  storageKey: "lfg_project_list",
  defaults: DEFAULTS,
  parse: (raw) => ({
    showPaths: (raw as Partial<ProjectListPrefs> | null)?.showPaths === true,
  }),
});

export function getProjectListPrefs(): ProjectListPrefs {
  return projectListPrefsStore.get();
}

export function setProjectListPrefs(patch: Partial<ProjectListPrefs>): void {
  projectListPrefsStore.set({ ...getProjectListPrefs(), ...patch });
}

export function subscribeProjectListPrefs(listener: () => void): () => void {
  return projectListPrefsStore.subscribe(listener);
}

// get() returns the cached object (stable identity between writes), so
// useSyncExternalStore won't re-render in a loop.
export function useProjectListPrefs(): ProjectListPrefs {
  return useSyncExternalStore(
    subscribeProjectListPrefs,
    getProjectListPrefs,
    getProjectListPrefs,
  );
}
