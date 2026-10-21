import { useCallback, useMemo, useRef } from "react";

/** Keep the virtualizer's measurement cache through scrolling and token updates.
 * A different key function invalidates every offset, even if every key is the
 * same. Only an insertion, removal, replacement, or reorder needs that reset.
 */
export function useChatItemKey(items: readonly { key: string }[]) {
  const previous = useRef<readonly string[]>([]);
  const keys = useMemo(() => {
    const current = previous.current;
    if (
      current.length === items.length &&
      items.every((item, index) => item.key === current[index])
    ) {
      return current;
    }
    return (previous.current = items.map((item) => item.key));
  }, [items]);
  return useCallback((index: number) => keys[index] ?? index, [keys]);
}
