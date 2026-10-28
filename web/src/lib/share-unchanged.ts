/**
 * `next`, with each item that is unchanged from `prev` replaced by the object
 * already in `prev`. Returns `prev` itself when no item changed and the order
 * is the same.
 *
 * A list read from the server is a new set of objects every time. A memoized
 * row compares its props by identity, so without this every row re-renders
 * whenever any one of them changed.
 */
export function shareUnchanged<T>(prev: readonly T[], next: T[], key: (item: T) => string | undefined): T[] {
  const prevByKey = new Map<string, { item: T; json: string }>();
  for (const item of prev) {
    const k = key(item);
    if (k) prevByKey.set(k, { item, json: JSON.stringify(item) });
  }
  let same = prev.length === next.length;
  const shared = next.map((item, index) => {
    const k = key(item);
    const old = k ? prevByKey.get(k) : undefined;
    const reused = old && old.json === JSON.stringify(item) ? old.item : item;
    if (reused !== prev[index]) same = false;
    return reused;
  });
  return same ? (prev as T[]) : shared;
}
