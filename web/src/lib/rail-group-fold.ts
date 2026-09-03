/**
 * Which rail groups the reader has folded shut.
 *
 * A fold is a reading posture, not fleet state: it lives in this browser's
 * localStorage under one key that the desktop rail and the mobile list share,
 * so the two surfaces cannot remember different answers to the same question.
 *
 * Keys are group identities, not labels: "__pinned" and "__auto" for the two
 * fixed groups, the project key for a folder group. A label can be shortened
 * or renamed; the identity cannot.
 */
export const FOLDED_RAIL_GROUPS_KEY = "lfg_folded_rail_groups";

export function parseFoldedRailGroups(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (value): value is string => typeof value === "string" && !!value,
        ),
      ),
    ];
  } catch {
    return [];
  }
}

/**
 * The default storage, resolved inside a try.
 *
 * A `storage: Storage = localStorage` default is evaluated before the callee's
 * try block, so a host with no `localStorage` at all — a non-DOM test runner,
 * a server render — threw a ReferenceError that no catch here could see.
 */
function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readFoldedRailGroups(storage: Storage | null = defaultStorage()): string[] {
  try {
    return parseFoldedRailGroups(storage?.getItem(FOLDED_RAIL_GROUPS_KEY) ?? null);
  } catch {
    return [];
  }
}

export function toggleFoldedRailGroup(
  current: readonly string[],
  key: string,
): string[] {
  return current.includes(key)
    ? current.filter((value) => value !== key)
    : [...current, key];
}

export function writeFoldedRailGroups(
  keys: readonly string[],
  storage: Storage | null = defaultStorage(),
): void {
  try {
    if (!storage) return;
    if (!keys.length) storage.removeItem(FOLDED_RAIL_GROUPS_KEY);
    else storage.setItem(FOLDED_RAIL_GROUPS_KEY, JSON.stringify([...new Set(keys)]));
  } catch {
    // Storage can be full or blocked; losing a fold preference is harmless.
  }
}

/**
 * One live copy of the fold set for the whole app.
 *
 * The fold was per-component state first, which had two faults. The desktop
 * rail and the mobile list mount their own `RailGroup`s, so a fold in one did
 * not reach the other until a remount. And the rail's keyboard order is built
 * outside any group, so it could not see a fold at all and walked rows that
 * were not on screen. Both want the same answer at the same time, so the
 * answer lives here and the components subscribe to it.
 *
 * Storage seeds this cache once and is written best effort after. A refused
 * write (private mode, quota) costs the fold on the next reload and nothing in
 * this session.
 */
let foldedCache: string[] | null = null;
const foldListeners = new Set<() => void>();

/** Stable snapshot: identity changes only when the set changes. */
export function getFoldedRailGroups(): string[] {
  if (!foldedCache) foldedCache = readFoldedRailGroups();
  return foldedCache;
}

export function subscribeFoldedRailGroups(listener: () => void): () => void {
  foldListeners.add(listener);
  return () => {
    foldListeners.delete(listener);
  };
}

/** Set one group's fold. `folded` is the wanted state, not a toggle. */
export function setFoldedRailGroup(key: string, folded: boolean): void {
  const current = getFoldedRailGroups();
  if (current.includes(key) === folded) return;
  const next = folded ? [...current, key] : current.filter((value) => value !== key);
  foldedCache = next;
  writeFoldedRailGroups(next);
  for (const listener of foldListeners) listener();
}

/** Tests only: drop the cache so a case can start from clean storage. */
export function resetFoldedRailGroupsCache(): void {
  foldedCache = null;
}
