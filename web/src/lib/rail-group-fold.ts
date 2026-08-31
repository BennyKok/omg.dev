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

export function readFoldedRailGroups(storage: Storage = localStorage): string[] {
  try {
    return parseFoldedRailGroups(storage.getItem(FOLDED_RAIL_GROUPS_KEY));
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
  storage: Storage = localStorage,
): void {
  try {
    if (!keys.length) storage.removeItem(FOLDED_RAIL_GROUPS_KEY);
    else storage.setItem(FOLDED_RAIL_GROUPS_KEY, JSON.stringify([...new Set(keys)]));
  } catch {
    // Storage can be full or blocked; losing a fold preference is harmless.
  }
}
