import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./omg-client";
import {
  mergeHistoryPage, omgMessagesToUIMessages,
  type OmgChatMessage, type OmgMessage,
} from "./omg-chat-transport";
import { readTranscriptCache, writeTranscriptCache } from "./transcript-cache";
import { transcriptOlderPagePath, transcriptPagePath } from "./transcript-paging";

type Page = { messages: OmgMessage[]; nextBefore?: number | null };
type SetMessages = (update: OmgChatMessage[] | ((current: OmgChatMessage[]) => OmgChatMessage[])) => void;

/** One history owner for cached pages, HTTP reads and live snapshots. */
export function useSessionHistory(
  sid: string | null | undefined,
  setMessages: SetMessages,
  onError: (message: string | null) => void,
) {
  const [loading, setLoading] = useState(false);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const scope = useRef({ sid, revision: 0 });
  const range = useRef<{ messages: OmgChatMessage[]; nextBefore: number | null } | null>(null);

  const applyPage = useCallback((page: Page) => {
    if (!sid) return;
    const history = omgMessagesToUIMessages(page.messages ?? []);
    const previous = range.current;
    const historyIds = new Set(history.map(message => message.id));
    const overlap = previous?.messages.findIndex(message => historyIds.has(message.id)) ?? -1;
    const olderKept = page.nextBefore != null && overlap > 0
      ? previous!.messages.slice(0, overlap) : [];
    const before = olderKept.length ? previous!.nextBefore : page.nextBefore ?? null;
    const previousIds = new Set(previous?.messages.map(message => message.id) ?? []);
    // The ref also records accepted ranges before React flushes the updater.
    range.current = { messages: [...olderKept, ...history], nextBefore: before };
    setMessages(current => {
      const settled = mergeHistoryPage(current, history, olderKept, previousIds);
      writeTranscriptCache(sid, settled, before);
      return settled;
    });
    setNextBefore(before);
    setLoading(false);
  }, [sid, setMessages]);

  useEffect(() => {
    const requestScope = { sid, revision: 0 };
    scope.current = requestScope;
    const cached = sid ? readTranscriptCache(sid) : null;
    range.current = cached;
    setMessages(cached?.messages ?? []);
    setNextBefore(cached?.nextBefore ?? null);
    setLoading(!!sid && !cached);
    if (!sid) return;
    let cancelled = false;
    const current = () => !cancelled && scope.current === requestScope && requestScope.revision === 0;
    void api<Page>(transcriptPagePath(sid), { cache: "no-store" })
      .then(page => { if (current()) applyPage(page); })
      .catch(error => {
        if (current()) onError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (current()) setLoading(false); });
    return () => { cancelled = true; };
  }, [sid, setMessages, onError, applyPage]);

  const applySnapshot = useCallback((page: Page) => {
    if (scope.current.sid !== sid) return;
    // An older HTTP read must not overwrite a snapshot or report a stale error.
    scope.current.revision += 1;
    applyPage(page);
  }, [sid, applyPage]);

  const loadOlderMessages = useCallback(async () => {
    if (!sid || nextBefore == null) return false;
    const requestScope = scope.current;
    const page = await api<Page>(transcriptOlderPagePath(sid, nextBefore), { cache: "no-store" });
    if (scope.current !== requestScope) return false;
    // A tail refresh can keep the same older boundary while this page loads.
    // If it replaced that boundary, let the reader retry the current cursor.
    if (range.current?.nextBefore !== nextBefore) return range.current?.nextBefore != null;
    const older = omgMessagesToUIMessages(page.messages ?? []);
    const before = page.nextBefore ?? null;
    setNextBefore(before);
    const existing = range.current?.messages ?? [];
    const ids = new Set(existing.map(message => message.id));
    range.current = { messages: [...older.filter(message => !ids.has(message.id)), ...existing], nextBefore: before };
    setMessages(current => {
      const currentIds = new Set(current.map(message => message.id));
      const prepend = older.filter(message => !currentIds.has(message.id));
      const settled = prepend.length ? [...prepend, ...current] : current;
      writeTranscriptCache(sid, settled, before);
      return settled;
    });
    return before !== null;
  }, [sid, nextBefore, setMessages]);

  return { loading, applySnapshot, loadOlderMessages };
}
