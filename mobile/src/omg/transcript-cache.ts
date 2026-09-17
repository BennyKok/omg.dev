/**
 * Session-switch transcript cache, for the phone.
 *
 * This is the native port of web/src/lib/transcript-cache.ts, and it exists
 * for the same reason, only more so. Opening a session on the phone blanks
 * the pane and waits on a fresh `/api/sessions/{id}/messages` round trip
 * EVERY time, including for a session that was open seconds ago, because the
 * screen is a route: expo-router pops it on back and React throws its
 * `useState` transcript away with it. The web app never unmounts, keeps a
 * page per session in memory, and paints it synchronously; the phone had no
 * equivalent, so every visit looked like a first visit.
 *
 * The phone also pays more for that round trip than the browser does. Its
 * transport is a hosted relay with a minted grant (see transport.ts), not a
 * direct call to the machine, so the latency the cache hides is real latency
 * and not a few milliseconds of localhost.
 *
 * Deliberately free of any `react-native` import. Everything here is a Map, a
 * timer and pure functions, which is what lets test/mobile-transcript-cache
 * exercise it as plain data.
 */

/**
 * One screenful of history: what the session screen asks for on open, and the
 * step every "load more" adds.
 *
 * It lives here, and not in app/session/[id].tsx where it is used, because
 * this module has to store and warm EXACTLY the page that screen asks for. A
 * cached page larger than the screen's first fetch would hand its "no more
 * history" test (lastCountRef) a first page bigger than the next one and make
 * it declare the start of the session reached; a smaller one would paint a
 * short transcript and jump. Two constants that must agree are one constant.
 *
 * Was 80. Opening a session means the FIRST page renders synchronously (see
 * `initialNumToRender` on that screen) so the reader never sees rows pop in,
 * and 80 of them is enough markdown and tool badges to make that synchronous
 * layout pass itself visible as a beat of nothing happening. 40 is still
 * several screens of scrollback before "load more" has to fire, and cuts the
 * initial layout cost roughly in half. `packages/client/src/index.ts`'s
 * `getMessages` default is deliberately left at 80: that is a general SDK
 * fallback for callers who do not pass a limit, not a mirror of this screen's
 * tuning, and the screen always passes its own `limit` explicitly.
 */
export const TRANSCRIPT_PAGE = 40;

/**
 * The little this module needs to know about a message.
 *
 * Kept structural rather than importing `Entry` from transcript.tsx, which
 * pulls in the whole renderer and with it React Native. The screen passes its
 * real `Entry[]` and gets `Entry[]` back through the generic.
 */
export type CachedMessage = { id?: unknown };

export type TranscriptCacheEntry<M extends CachedMessage = CachedMessage> = {
  messages: M[];
  /** When the entry was last written or refreshed. Diagnostics only. */
  at: number;
};

/**
 * Bounded so a long-lived app that visits many sessions cannot grow without
 * limit. Insertion-ordered Map = a cheap LRU, because a read re-sets the key.
 */
const MAX_SESSIONS = 24;

const cache = new Map<string, TranscriptCacheEntry>();

/**
 * ONE MACHINE'S TRANSCRIPT IS NOT ANOTHER'S.
 *
 * Session ids are minted per machine, so the key has to carry the binding.
 * Without it, switching Computers could paint the previous machine's
 * transcript under a same-id session on the new one. The web has no such
 * problem and no such key: a browser tab is already scoped to one origin.
 */
export function transcriptCacheKey(
  bindingId: string | null | undefined,
  sessionId: string,
): string {
  return `${bindingId ?? "none"}:${sessionId}`;
}

function trim() {
  for (const key of cache.keys()) {
    if (cache.size <= MAX_SESSIONS) return;
    cache.delete(key);
  }
}

/**
 * Optimistic rows are client state, not transcript.
 *
 * A message the composer has sent but the machine has not echoed is keyed
 * `local-N` (see isOptimisticId in app/session/[id].tsx). Caching one would
 * repaint it as still sending on re-open, minutes after the agent answered
 * it. The cache keeps only rows the machine has confirmed.
 */
function settledOnly<M extends CachedMessage>(messages: M[]): M[] {
  const settled = messages.filter(
    (message) => !(typeof message.id === "string" && message.id.startsWith("local-")),
  );
  return settled.length === messages.length ? messages : settled;
}

export function readTranscriptCache<M extends CachedMessage>(
  key: string,
): TranscriptCacheEntry<M> | null {
  const entry = cache.get(key) as TranscriptCacheEntry<M> | undefined;
  if (!entry) return null;
  // Refresh LRU position on read.
  cache.delete(key);
  cache.set(key, entry as TranscriptCacheEntry);
  return entry;
}

/**
 * Store the tail of a transcript.
 *
 * `keep` is the screen's own page size, and only the last `keep` messages are
 * stored, on purpose. The screen re-opens at one page and grows `limit` as
 * the reader scrolls back, and its "no more history" test compares successive
 * page sizes (see lastCountRef). Caching a longer, paged-back list would
 * hand that test a first page bigger than the one the next fetch returns and
 * make it declare the start of the session reached. One page in, one page
 * out: the scrollback a reader loaded is re-fetched, exactly as it is today.
 */
export function writeTranscriptCache<M extends CachedMessage>(
  key: string,
  messages: M[],
  keep: number,
) {
  if (!key) return;
  cache.delete(key);
  cache.set(key, {
    messages: settledOnly(messages).slice(-keep),
    at: Date.now(),
  });
  trim();
}

/**
 * Keep a cached page current as live events land, without creating an entry
 * for a session no page was ever loaded for, and without disturbing LRU
 * order. This is what makes the cached paint usually already correct rather
 * than a snapshot of whenever the reader last left.
 */
export function updateTranscriptCacheMessages<M extends CachedMessage>(
  key: string,
  messages: M[],
  keep: number,
) {
  const entry = cache.get(key);
  if (!entry) return;
  entry.messages = settledOnly(messages).slice(-keep) as CachedMessage[];
  entry.at = Date.now();
}

export function clearTranscriptCache(key?: string) {
  if (key) {
    cache.delete(key);
    attempted.delete(key);
    return;
  }
  cache.clear();
  attempted.clear();
  queue.length = 0;
}

/** How many of the top-of-list sessions to warm ahead of the reader opening one. */
const PREFETCH_COUNT = 8;

/**
 * Module-level, not a component ref: the sessions screen remounts (a machine
 * switch, a profile change) and a per-instance ref would re-run the whole
 * sweep each time.
 */
const attempted = new Set<string>();
const queue: string[] = [];
let sweeping = false;

/** Off the critical path of the list's first paint. */
function whenIdle(run: () => void) {
  setTimeout(run, 500);
}

/**
 * Warm the cache for the first few sessions in the order the reader actually
 * sees them, so the FIRST open of a session paints instantly too, not just a
 * re-open. Best-effort and idempotent: every key is attempted at most once,
 * and a page the reader's own open already wrote is never clobbered.
 */
export function prefetchTranscripts<M extends CachedMessage>(
  orderedKeys: readonly string[],
  load: (key: string) => Promise<M[]>,
  keep: number,
) {
  for (const key of orderedKeys
    .filter((key) => key && !attempted.has(key) && !cache.has(key))
    .slice(0, PREFETCH_COUNT)) {
    if (!queue.includes(key)) queue.push(key);
  }
  if (!queue.length || sweeping) return;
  sweeping = true;
  whenIdle(async () => {
    try {
      // Serial: background work must never contend with the fetch for a
      // session the reader actually opened.
      while (queue.length) {
        const key = queue.shift() as string;
        if (attempted.has(key) || cache.has(key)) continue;
        attempted.add(key);
        try {
          const messages = await load(key);
          if (cache.has(key)) continue;
          writeTranscriptCache(key, messages, keep);
        } catch {
          // Best-effort; opening the session still fetches normally.
        }
      }
    } finally {
      sweeping = false;
    }
  });
}
