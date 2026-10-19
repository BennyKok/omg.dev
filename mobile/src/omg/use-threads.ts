import { useCallback, useEffect, useState } from "react";
import { liveCollection, type OmgClient, type OmgLiveCollection } from "@omg-dev/client";
import { useOmg } from "./provider";
import { listThreads, updateThread, type ThreadSummary } from "./threads";

const collections = new WeakMap<OmgClient, OmgLiveCollection<ThreadSummary[]>>();

/**
 * The machine's thread list, one shared read per client. The Computer sends a
 * `changed` frame for "threads" on every thread write, including each new
 * message, so the list is re-read at once, with a 5-minute backstop
 * (liveCollection in @omg-dev/client).
 */
export function threadsCollection(client: OmgClient): OmgLiveCollection<ThreadSummary[]> {
  let collection = collections.get(client);
  if (!collection) {
    // A failed read keeps the last value; a machine from before threads
    // answers 404 and the section stays empty.
    collection = liveCollection(client.live, "threads", () => listThreads(client));
    collections.set(client, collection);
  }
  return collection;
}

/** Home's thread list. */
export function useThreads(): { threads: ThreadSummary[]; refresh: () => Promise<void>; archive: (id: string) => void } {
  const { client, bindingId } = useOmg();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  useEffect(() => {
    setThreads([]);
    if (!client) return;
    const collection = threadsCollection(client);
    const cached = collection.peek();
    if (cached) setThreads(cached);
    return collection.subscribe(setThreads);
  }, [client, bindingId]);
  const refresh = useCallback(async () => {
    if (client) await threadsCollection(client).refresh();
  }, [client]);
  const archive = useCallback((id: string) => {
    if (!client) return;
    setThreads((rows) => rows.filter((row) => row.id !== id));
    void updateThread(client, id, { archived: true }).catch(() => void refresh());
  }, [client, refresh]);
  return { threads, refresh, archive };
}
