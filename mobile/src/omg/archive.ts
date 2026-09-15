export type ArchivedSession = {
  sessionId: string;
  title: string;
  agent: string;
  project: string;
  cwd: string | null;
  lastUserText: string | null;
  lastActivityAt: number | null;
};
export type ArchiveTransport = {
  request<T>(path: string, init?: RequestInit): Promise<T>;
};
/**
 * `includeScheduled` is off by default, on the server AND here.
 *
 * Auto-agent runs are the bulk of the catalog on a busy box and none of them
 * is a conversation a human wants to resume, so `/api/sessions/resumable`
 * hides them unless asked. The web has had a control to ask since the archive
 * work landed; this app had no way to say it at all, which is why the runs
 * simply vanished here with nothing explaining where they went.
 */
export function archiveUrl(search: string, offset = 0, includeScheduled = false) {
  const params = new URLSearchParams({ limit: "30", offset: String(offset) });
  if (search.trim()) params.set("search", search.trim());
  if (includeScheduled) params.set("includeScheduled", "1");
  return `/api/sessions/resumable?${params}`;
}
export async function resumeArchivedSession(
  transport: ArchiveTransport,
  sessionId: string,
) {
  const result = await transport.request<{ sessionId?: string }>(
    "/api/sessions/resume",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    },
  );
  return result.sessionId || sessionId;
}
export function createArchiveBrowser(transport: ArchiveTransport) {
  let generation = 0;
  let state = {
    items: [] as ArchivedSession[],
    total: 0,
    /** How many scheduled runs the current search matches, shown or not. */
    scheduledTotal: 0,
    loading: false,
    error: null as string | null,
  };
  const listeners = new Set<() => void>();
  const publish = (next: typeof state) => {
    state = next;
    listeners.forEach((fn) => fn());
  };
  let search = "";
  let includeScheduled = false;
  const load = async (reset: boolean) => {
    if (!reset && (state.loading || state.items.length >= state.total)) return;
    if (reset) generation++;
    const token = generation;
    const offset = reset ? 0 : state.items.length;
    publish({
      ...state,
      items: reset ? [] : state.items,
      loading: true,
      error: null,
    });
    try {
      const result = await transport.request<{
        sessions: ArchivedSession[];
        total?: number;
        scheduledTotal?: number;
      }>(archiveUrl(search, offset, includeScheduled));
      if (token !== generation) return;
      const items = offset
        ? [...state.items, ...result.sessions]
        : result.sessions;
      publish({
        items,
        total: result.total ?? items.length,
        scheduledTotal: result.scheduledTotal ?? 0,
        loading: false,
        error: null,
      });
    } catch (e) {
      if (token === generation)
        publish({
          ...state,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
    }
  };
  return {
    snapshot: () => state,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    search(value: string) {
      search = value;
      return load(true);
    },
    /** Show or hide scheduled runs. Re-queries, because the server filters. */
    setIncludeScheduled(value: boolean) {
      includeScheduled = value;
      return load(true);
    },
    includesScheduled: () => includeScheduled,
    more: () => load(false),
    refresh: () => load(true),
    cancel() {
      generation++;
    },
  };
}
