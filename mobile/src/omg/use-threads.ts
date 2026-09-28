import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useOmg } from "./provider";
import { listThreads, updateThread, type ThreadSummary } from "./threads";

const LIST_POLL_MS = 10_000;

/** Home's thread list: loaded on mount, then polled while the app is active. */
export function useThreads(): { threads: ThreadSummary[]; refresh: () => Promise<void>; archive: (id: string) => void } {
  const { client, bindingId } = useOmg();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const rows = await listThreads(client);
      if (alive.current) setThreads(rows);
    } catch {
      // A machine from before threads answers 404; the section stays empty.
    }
  }, [client]);
  useEffect(() => {
    alive.current = true;
    setThreads([]);
    void refresh();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, LIST_POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refresh, bindingId]);
  const archive = useCallback((id: string) => {
    if (!client) return;
    setThreads((rows) => rows.filter((row) => row.id !== id));
    void updateThread(client, id, { archived: true }).catch(() => void refresh());
  }, [client, refresh]);
  return { threads, refresh, archive };
}
