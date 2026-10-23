/**
 * The previous record when `next` has the same keys mapped to the same values.
 *
 * The live transcript hooks prune their per-session maps on every session-list
 * change. A rebuilt map with identical entries is still a new object, and a new
 * object is a state change, so React rendered App a second time after each list
 * update for nothing. On a busy server that was every few seconds.
 */
export function sameEntries<T>(prev: Record<string, T>, next: Record<string, T>): Record<string, T> {
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(prev).length) return next;
  for (const key of keys) {
    if (!Object.hasOwn(prev, key) || prev[key] !== next[key]) return next;
  }
  return prev;
}

/**
 * One empty list, so "nothing to show" is the same value on every update.
 * Shared, so never mutate it; copy first, as every list in the app already does.
 */
export const NO_ITEMS: never[] = [];
