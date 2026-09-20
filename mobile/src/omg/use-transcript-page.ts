import { useCallback, useEffect, useState } from "react";
import type { Entry } from "./transcript";
import {
  TRANSCRIPT_PAGE, transcriptCacheKey, readTranscriptCache,
  writeTranscriptCache, updateTranscriptCacheMessages,
} from "./transcript-cache";

type Client = { getMessages(id: string, limit: number): Promise<{ messages?: Entry[] }> };

/** The screen's single page owner: synchronous cache seed, then background REST. */
export function useTranscriptPage(client: Client | null, bindingId: string | null | undefined,
  id: string | null, onError: (error: string | null) => void) {
  const cacheKey = id ? transcriptCacheKey(bindingId, id) : null;
  const [initialCache] = useState(() => cacheKey ? readTranscriptCache<Entry>(cacheKey) : null);
  const [messages, setMessages] = useState<Entry[]>(() => initialCache?.messages ?? []);
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
      if (cancelled) return;
      const next = res.messages ?? [];
      setMessages(next);
      setReachedStart(next.length < limit);
      if (cacheKey) writeTranscriptCache(cacheKey, next, TRANSCRIPT_PAGE);
      onError(null);
    }).catch((error) => {
      if (!cancelled && !cached) onError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) { setLoading(false); setLoadingMore(false); }
    });
    return () => { cancelled = true; };
  }, [client, id, limit, cacheKey, onError]);

  useEffect(() => {
    if (cacheKey) updateTranscriptCacheMessages(cacheKey, messages, TRANSCRIPT_PAGE);
  }, [cacheKey, messages]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || reachedStart) return;
    setLoadingMore(true);
    setLimit((current) => current + TRANSCRIPT_PAGE);
  }, [loading, loadingMore, reachedStart]);
  return { messages, setMessages, loading, loadingMore, reachedStart, loadMore };
}
