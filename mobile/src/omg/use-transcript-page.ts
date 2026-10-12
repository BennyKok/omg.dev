import { sessionCache } from "./session-cache-store";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Entry } from "./transcript";
import {
  TRANSCRIPT_PAGE, transcriptCacheKey, readTranscriptCache,
  writeTranscriptCache, updateTranscriptCacheMessages,
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

export function useTranscriptPage(client: Client | null, bindingId: string | null | undefined,
  id: string | null, onError: (error: string | null) => void, initialPrompt?: string) {
  const [scopeEpoch] = useState(() => sessionCache.epoch);
  const cacheKey = id ? transcriptCacheKey(bindingId, id) : null;
  const [initialCache] = useState(() => cacheKey ? readTranscriptCache<Entry>(cacheKey) : null);
  const [messages, setMessages] = useState<Entry[]>(() => initialCache?.messages
    // `ts` is not decoration. `buildTranscriptItems` stamps the first row of a
    // transcript and skips any row without a time (`if (!ts) return`), so an
    // optimistic opener with no `ts` drew no stamp — and then the settled row
    // arrived carrying one, pushing the whole conversation down. Local clock
    // is right to the minute the stamp actually prints.
    ?? (initialPrompt ? [{ id: `local-create-${id}`, role: "user", text: initialPrompt, ts: Date.now() }] : []));
  const [loading, setLoading] = useState(!!id && !initialCache);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
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
  const cursor = useRef<number | null | undefined>(undefined);
  const legacyLimit = useRef<number | null>(null);
  const wantsMore = useRef(false);
  const [cursorVersion, setCursorVersion] = useState(0);

  const setCursor = useCallback((next: number | null | undefined, count: number, asked: number) => {
    if (next === undefined) {
      cursor.current = undefined;
      legacyLimit.current = asked;
      setReachedStart(count < asked);
    } else {
      cursor.current = next;
      legacyLimit.current = null;
      setReachedStart(next === null);
    }
    setCursorVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!client || !id) return;
    let cancelled = false;
    const cached = cacheKey ? readTranscriptCache<Entry>(cacheKey) : null;
    setLoading(!cached);
    client.getMessages(id, TRANSCRIPT_PAGE).then((res) => {
      if (cancelled || sessionCache.epoch !== scopeEpoch) return;
      const next = res.messages ?? [];
      setMessages((prev) => keepOpener(prev, next));
      setCursor(res.nextBefore, next.length, TRANSCRIPT_PAGE);
      if (cacheKey) writeTranscriptCache(cacheKey, next, TRANSCRIPT_PAGE);
      onError(null);
    }).catch((error) => {
      if (!cancelled && !cached) onError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [client, id, cacheKey, onError, scopeEpoch, setCursor]);

  useEffect(() => {
    if (cacheKey && sessionCache.epoch === scopeEpoch) updateTranscriptCacheMessages(cacheKey, messages, TRANSCRIPT_PAGE);
  }, [cacheKey, messages, scopeEpoch]);

  const loadMore = useCallback(() => {
    if (!client || !id || loadingMore || reachedStart) return;
    const before = cursor.current;
    const legacy = legacyLimit.current;
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
      const page = res.messages ?? [];
      if (before === undefined) {
        // Legacy machine: the answer is the whole grown window.
        setMessages((prev) => keepOpener(prev, page));
        setCursor(undefined, page.length, (legacy ?? TRANSCRIPT_PAGE) + TRANSCRIPT_PAGE);
        return;
      }
      // A snapshot that reset the cursor meanwhile owns the list now.
      if (cursor.current !== before) return;
      setMessages((prev) => prependOlder(page, prev));
      setCursor(res.nextBefore ?? null, page.length, TRANSCRIPT_PAGE);
    }).catch((error) => {
      onError(error instanceof Error ? error.message : String(error));
    }).finally(() => setLoadingMore(false));
  }, [client, id, loadingMore, reachedStart, scopeEpoch, onError, setCursor]);

  // Run a scroll-to-top that arrived before the cursor did.
  useEffect(() => {
    if (wantsMore.current && (cursor.current !== undefined || legacyLimit.current !== null)) loadMore();
  }, [cursorVersion, loadMore]);

  /**
   * The live socket's snapshot is a fresh tail with its own cursor. It
   * replaces the list, so it must replace the cursor too, or the next page
   * back would start from a point the list no longer reaches and leave a gap.
   */
  const applySnapshot = useCallback((next: Entry[], nextBefore: number | null | undefined) => {
    setMessages((prev) => keepOpener(prev, next));
    setCursor(nextBefore, next.length, TRANSCRIPT_PAGE);
  }, [setCursor]);

  return { messages, setMessages, applySnapshot, loading, loadingMore, reachedStart, loadMore };
}
