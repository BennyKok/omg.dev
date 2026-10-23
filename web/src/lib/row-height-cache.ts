/**
 * Estimated transcript row heights, shared by every transcript mount.
 *
 * The chat stage keys its pane on the session id, so a session switch mounts
 * a new transcript. A cache owned by that mount died with it, and coming back
 * to a session estimated every row again with text layout: tens of
 * milliseconds per switch, inside the click's long task. Keys carry the row's
 * identity and every input of the estimate, so entries from different
 * sessions or widths cannot collide.
 */

export type RowHeightCache = {
  get(key: string): number | undefined;
  set(key: string, height: number): void;
  readonly size: number;
  clear(): void;
};

/**
 * A bounded map that drops its oldest entries once full. A streaming row
 * mints a new key per token, so the bound is what keeps one long session from
 * growing it without limit.
 */
export function createRowHeightCache(limit = 8000): RowHeightCache {
  const map = new Map<string, number>();
  return {
    get: (key) => map.get(key),
    set(key, height) {
      if (map.has(key)) map.delete(key);
      map.set(key, height);
      if (map.size <= limit) return;
      // Drop a tenth at once so a stream does not pay an eviction per token.
      let drop = Math.max(1, Math.floor(limit / 10));
      for (const old of map.keys()) {
        map.delete(old);
        if (--drop === 0) break;
      }
    },
    get size() {
      return map.size;
    },
    clear: () => map.clear(),
  };
}

export const chatRowHeights = createRowHeightCache();

/** Every input of one row's estimate. */
export function chatRowHeightKey(parts: {
  rowKey: string;
  metricsVersion: number;
  modelVersion: number | string;
  width: number;
  speakerChanged: boolean;
  textLength: number;
}): string {
  return `${parts.rowKey}|${parts.metricsVersion}|${parts.modelVersion}|${Math.round(parts.width)}|${parts.speakerChanged ? 1 : 0}|${parts.textLength}`;
}
