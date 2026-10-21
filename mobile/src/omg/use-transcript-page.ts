import { sessionCache } from "./session-cache-store";
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import type { Entry } from "./transcript";
import {
  TRANSCRIPT_PAGE, transcriptCacheKey, readTranscriptCache,
  writeTranscriptCache,
} from "./transcript-cache";

type Page = { messages?: Entry[]; nextBefore?: number | null };
type Client = {
  getMessages(id: string, limit: number): Promise<Page>;
  transport?: { request<T>(path: string, init?: RequestInit): Promise<T> };
};

/**
 * The page before `before`, in the same folded shape as the live tail.
 *
 * The pinned SDK has no method for this route, so the request goes through
 * the client's own transport. `workRows=1` must match the capability the
 * provider declares, or the older page arrives unfolded next to a folded tail.
 * `rows` makes the machine keep reading back until the page fills a screen;
 * a run of tool calls folds to one row, so 40 raw messages can be 7 rows.
 */
export function olderTranscriptPagePath(id: string, before: number): string {
  return `/api/sessions/${encodeURIComponent(id)}/messages?page=backward&before=${before}`
    + `&limit=${TRANSCRIPT_PAGE}&rows=${TRANSCRIPT_PAGE}&workRows=1`;
}

/** Older rows go in front. A row the reader already has is not repeated. */
export function prependOlder<T extends { id?: string | null }>(older: T[], current: T[]): T[] {
  const have = new Set(current.map((m) => m.id).filter(Boolean));
  const fresh = older.filter((m) => !m.id || !have.has(m.id));
  return fresh.length ? [...fresh, ...current] : current;
}

/** The screen's single page owner: synchronous cache seed, then background REST. */
/**
 * An empty answer does not erase the opener.
 *
 * A session created a moment ago can answer its first read, and its first
 * live snapshot, with no messages yet. Replacing the local opener with that
 * empty list flashed "No messages yet." between the prompt and the real
 * transcript (onboarding's chat card, 2026-09-25). A non-empty answer always
 * wins; only "nothing yet" is ignored while the opener is all there is.
 */
export function keepOpener<T extends { id?: string | null; role?: string | null; text?: string | null; localKey?: string }>(
  prev: T[],
  next: T[],
): T[] {
  const openerOnly = prev.length > 0 && prev.every((m) => String(m.id ?? "").startsWith("local-create-"));
  if (next.length === 0) return openerOnly ? prev : next;
  if (!openerOnly) return next;
  // The machine's first user row IS the opener arriving (it carries the
  // launch envelope around the same words). Keep the opener's row key on it,
  // as the live `message` echo already does, so the list settles one row
  // instead of unmounting the opener and animating a new row in.
  const opener = prev[0]!;
  const words = opener.text?.trim();
  const index = words ? next.findIndex((m) => m.role === "user" && !!m.text?.includes(words)) : -1;
  if (index < 0 || next[index]!.localKey) return next;
  const settled = [...next];
  settled[index] = { ...next[index]!, localKey: String(opener.id) };
  return settled;
}

type TranscriptPageState = {
  messages: Entry[];
  cursor: number | null | undefined;
  legacyLimit: number | null;
  reachedStart: boolean;
  /** Changes only when a snapshot replaces the loaded history boundary. */
  boundary: number;
};

function pageCursor(next: number | null | undefined, count: number, asked: number) {
  return {
    cursor: next,
    legacyLimit: next === undefined ? asked : null,
    reachedStart: next === undefined ? count < asked : next === null,
  };
}

/** A reconnect sends a tail, not a deletion of the older pages on screen. */
function refreshPage(prev: TranscriptPageState, next: Entry[], nextBefore: number | null | undefined): TranscriptPageState {
  const first = next[0]?.id;
  const overlap = first ? prev.messages.findIndex(message => message.id === first) : -1;
  // Only join at a known row. A disjoint snapshot cannot prove continuity.
  // A complete history (null cursor) is authoritative, including deletions.
  const keepHistory = nextBefore != null && prev.legacyLimit === null &&
    prev.cursor !== undefined && overlap >= 0;
  const localKeys = new Map(prev.messages.filter(message => message.id && message.localKey)
    .map(message => [message.id, message.localKey]));
  const tail = next.map(message => {
    const localKey = message.id ? localKeys.get(message.id) : undefined;
    return localKey && !message.localKey ? { ...message, localKey } : message;
  });
  return {
    ...prev,
    ...(keepHistory ? {} : pageCursor(nextBefore, next.length, TRANSCRIPT_PAGE)),
    messages: keepHistory ? [...prev.messages.slice(0, overlap), ...tail] : keepOpener(prev.messages, tail),
    boundary: prev.boundary + (keepHistory ? 0 : 1),
  };
}

export function useTranscriptPage(client: Client | null, bindingId: string | null | undefined,
  id: string | null, onError: (error: string | null) => void, initialPrompt?: string) {
  const [scopeEpoch] = useState(() => sessionCache.epoch);
  const cacheKey = id ? transcriptCacheKey(bindingId, id) : null;
  const [initialCache] = useState(() => cacheKey ? readTranscriptCache<Entry>(cacheKey) : null);
  // The messages and cursor describe one loaded range and must change together.
  const [page, setPage] = useState<TranscriptPageState>(() => ({ messages: initialCache?.messages
    // `ts` is not decoration. `buildTranscriptItems` stamps the first row of a
    // transcript and skips any row without a time (`if (!ts) return`), so an
    // optimistic opener with no `ts` drew no stamp — and then the settled row
    // arrived carrying one, pushing the whole conversation down. Local clock
    // is right to the minute the stamp actually prints.
    ?? (initialPrompt ? [{ id: `local-create-${id}`, role: "user", text: initialPrompt, ts: Date.now() }] : []),
    cursor: undefined, legacyLimit: null, reachedStart: false, boundary: 0,
  }));
  const { messages, cursor, legacyLimit, reachedStart, boundary } = page;
  const setMessages = useCallback((update: SetStateAction<Entry[]>) => {
    setPage(prev => {
      const messages = typeof update === "function" ? update(prev.messages) : update;
      return messages === prev.messages ? prev : { ...prev, messages };
    });
  }, []);
  const [loading, setLoading] = useState(!!id && !initialCache);
  const [loadingMore, setLoadingMore] = useState(false);
  const snapshotRevision = useRef(0);
  /**
   * WHERE THE NEXT OLDER PAGE STARTS, as the machine reports it.
   *
   * The end of history is `nextBefore === null`, never "fewer rows than I
   * asked for". The client declares `workRows`, so the machine folds each run
   * of tool calls into one row: a 1566-message session answered a page of 40
   * with 7 rows, and the old length test declared the start reached on the
   * first scroll up. The old approach also grew one request (40, 80, 120 ...)
   * that the machine caps at 200, so even raw pages hit a wall.
   *
   * `undefined` means not known yet (the tail has not answered). A machine
   * too old to send a cursor keeps the old growing-limit request.
   */
  const wantsMore = useRef(false);

  useEffect(() => {
    if (!client || !id) return;
    let cancelled = false;
    const revision = snapshotRevision.current;
    const cached = cacheKey ? readTranscriptCache<Entry>(cacheKey) : null;
    setLoading(!cached);
    client.getMessages(id, TRANSCRIPT_PAGE).then((res) => {
      if (cancelled || sessionCache.epoch !== scopeEpoch || snapshotRevision.current !== revision) return;
      const next = res.messages ?? [];
      // A live snapshot may beat this initial REST request. Its range wins.
      setPage(prev => refreshPage(prev, next, res.nextBefore));
      onError(null);
    }).catch((error) => {
      if (!cancelled && !cached) onError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [client, id, cacheKey, onError, scopeEpoch]);

  useEffect(() => {
    if (cacheKey && sessionCache.epoch === scopeEpoch && (cursor !== undefined || legacyLimit !== null)) {
      writeTranscriptCache(cacheKey, messages, TRANSCRIPT_PAGE);
    }
  }, [cacheKey, messages, cursor, legacyLimit, scopeEpoch]);

  const loadMore = useCallback(() => {
    if (!client || !id || loadingMore || reachedStart) return;
    const before = cursor;
    const legacy = legacyLimit;
    // A scroll to the top before the tail answers is remembered, not dropped:
    // the reader may already be parked there when the cursor arrives.
    if (before === undefined && legacy === null) { wantsMore.current = true; return; }
    wantsMore.current = false;
    if (before === null) return;
    setLoadingMore(true);
    const request: Promise<Page> = before !== undefined && client.transport
      ? client.transport.request<Page>(olderTranscriptPagePath(id, before), { cache: "no-store" })
      : client.getMessages(id, (legacy ?? TRANSCRIPT_PAGE) + TRANSCRIPT_PAGE);
    request.then((res) => {
      if (sessionCache.epoch !== scopeEpoch) return;
      const older = res.messages ?? [];
      setPage(prev => {
        if (prev.boundary !== boundary || prev.cursor !== before) return prev;
        if (before === undefined) {
          // Legacy machine: the answer is the whole grown window.
          return { ...prev, messages: keepOpener(prev.messages, older),
            ...pageCursor(undefined, older.length, (legacy ?? TRANSCRIPT_PAGE) + TRANSCRIPT_PAGE) };
        }
        return { ...prev, messages: prependOlder(older, prev.messages),
          ...pageCursor(res.nextBefore ?? null, older.length, TRANSCRIPT_PAGE) };
      });
    }).catch((error) => {
      onError(error instanceof Error ? error.message : String(error));
    }).finally(() => setLoadingMore(false));
  }, [client, id, loadingMore, reachedStart, scopeEpoch, onError, cursor, legacyLimit, boundary]);

  // Run a scroll-to-top that arrived before the cursor did.
  useEffect(() => {
    if (wantsMore.current && (cursor !== undefined || legacyLimit !== null)) loadMore();
  }, [cursor, legacyLimit, loadMore]);

  /**
   * Refresh the overlapping tail and retain the older loaded range. The cursor
   * still belongs to its first row. Only a disjoint/full snapshot replaces it.
   */
  const applySnapshot = useCallback((next: Entry[], nextBefore: number | null | undefined) => {
    snapshotRevision.current += 1;
    setPage(prev => refreshPage(prev, next, nextBefore));
  }, []);

  return { messages, setMessages, applySnapshot, loading, loadingMore, reachedStart, loadMore };
}
