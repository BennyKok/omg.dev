import { useEffect, useSyncExternalStore } from "react";

import { api } from "./omg-client";

// When each folder was last used, and which folders count as inactive.
//
// The server owns the history (GET /api/repos/activity, read from the session
// cache). This module keeps one copy for the page, so the phone's Folders page
// and the desktop folder menu agree on the same order and the same groups.

/** A folder with no chat for this long is grouped as inactive. */
export const INACTIVE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** Re-read the history at most this often. */
const REFETCH_MS = 60_000;

let snapshot: ReadonlyMap<string, number> = new Map();
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

async function load(): Promise<void> {
  if (inFlight) return inFlight;
  if (Date.now() - fetchedAt < REFETCH_MS) return;
  inFlight = api<{ lastActivity?: Record<string, unknown> }>("/api/repos/activity")
    .then((data) => {
      const next = new Map<string, number>();
      for (const [project, at] of Object.entries(data?.lastActivity ?? {})) {
        if (typeof at === "number" && Number.isFinite(at)) next.set(project, at);
      }
      snapshot = next;
      fetchedAt = Date.now();
      emit();
    })
    .catch(() => {
      // An older server has no route. The list falls back to live chats only.
      fetchedAt = Date.now();
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The newest activity per folder: the server history, raised by any newer
 * live activity the caller already knows.
 */
export function useFolderActivity(live?: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const history = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  useEffect(() => {
    void load();
  }, []);
  if (!live?.size) return history;
  const merged = new Map(history);
  for (const [project, at] of live) if (at > (merged.get(project) ?? 0)) merged.set(project, at);
  return merged;
}

/**
 * Split folders into the ones in use and the ones idle for INACTIVE_AFTER_MS.
 * `keep` stays active whatever its age: the current folder must always have a
 * visible row. With no history at all, nothing is grouped, so a server
 * without the activity route shows the flat list it always showed.
 */
export function splitByActivity<T extends { value: string }>(
  folders: readonly T[],
  lastActivity: ReadonlyMap<string, number>,
  options: { now?: number; keep?: string } = {},
): { active: T[]; inactive: T[] } {
  if (!lastActivity.size) return { active: [...folders], inactive: [] };
  const cutoff = (options.now ?? Date.now()) - INACTIVE_AFTER_MS;
  const active: T[] = [];
  const inactive: T[] = [];
  for (const folder of folders) {
    const at = lastActivity.get(folder.value) ?? 0;
    if (at >= cutoff || folder.value === options.keep) active.push(folder);
    else inactive.push(folder);
  }
  return { active, inactive };
}

/** Newest first, then by name. */
export function byRecent<T extends { value: string }>(
  folders: readonly T[],
  lastActivity: ReadonlyMap<string, number>,
  labelFor: (value: string) => string,
): T[] {
  return [...folders].sort(
    (a, b) =>
      (lastActivity.get(b.value) ?? 0) - (lastActivity.get(a.value) ?? 0) ||
      labelFor(a.value).localeCompare(labelFor(b.value)),
  );
}

export function resetFolderActivityForTests(seed?: ReadonlyMap<string, number>): void {
  snapshot = seed ?? new Map();
  // A seed counts as a fresh read, so the hook does not fetch over it.
  fetchedAt = seed ? Date.now() : 0;
  inFlight = null;
  emit();
}
