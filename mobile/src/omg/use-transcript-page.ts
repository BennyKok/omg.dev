import { sessionCache } from "./session-cache-store";
import { useCallback, useEffect, useState } from "react";
import type { Entry } from "./transcript";
import {
  TRANSCRIPT_PAGE, transcriptCacheKey, readTranscriptCache,
  writeTranscriptCache, updateTranscriptCacheMessages,
} from "./transcript-cache";

type Client = { getMessages(id: string, limit: number): Promise<{ messages?: Entry[] }> };

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
  const [limit, setLimit] = useState(TRANSCRIPT_PAGE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);

  useEffect(() => {
    if (!client || !id) return;
    let cancelled = false;
    const cached = cacheKey ? readTranscriptCache<Entry>(cacheKey) : null;
    // Never overwrite an expanded page with the cached tail on pagination.
    if (limit === TRANSCRIPT_PAGE) setLoading(!cached);
    client.getMessages(id, limit).then((res) => {
      if (cancelled || sessionCache.epoch !== scopeEpoch) return;
      const next = res.messages ?? [];
      setMessages((prev) => keepOpener(prev, next));
      setReachedStart(next.length < limit);
      if (cacheKey) writeTranscriptCache(cacheKey, next, TRANSCRIPT_PAGE);
      onError(null);
    }).catch((error) => {
      if (!cancelled && !cached) onError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) { setLoading(false); setLoadingMore(false); }
    });
    return () => { cancelled = true; };
  }, [client, id, limit, cacheKey, onError, scopeEpoch]);

  useEffect(() => {
    if (cacheKey && sessionCache.epoch === scopeEpoch) updateTranscriptCacheMessages(cacheKey, messages, TRANSCRIPT_PAGE);
  }, [cacheKey, messages, scopeEpoch]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || reachedStart) return;
    setLoadingMore(true);
    setLimit((current) => current + TRANSCRIPT_PAGE);
  }, [loading, loadingMore, reachedStart]);
  return { messages, setMessages, loading, loadingMore, reachedStart, loadMore };
}
