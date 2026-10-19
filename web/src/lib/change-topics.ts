import { settlePendingOmgReads } from "./omg-client";
import type { ChangeTopic } from "../useLiveSocket";

/** Shared list invalidations, including a full refresh on reconnect. */
type Listener = (topics: ChangeTopic[]) => void;

const listeners = new Set<Listener>();
let live = false;

export function setListsLive(next: boolean): void {
  live = next;
}

export function listsLive(): boolean {
  return live;
}

export async function emitListChanges(topics: ChangeTopic[]): Promise<void> {
  // Do not join a GET that began before the write this event announces.
  // Once those reads settle, listeners get a new authoritative response.
  await settlePendingOmgReads();
  for (const listener of listeners) {
    try {
      listener(topics);
    } catch {}
  }
}

/** Run `listener` when `topic` changes, or when the socket (re)opens. */
export function onListChange(topic: ChangeTopic, listener: () => void): () => void {
  const wrapped: Listener = (topics) => {
    if (topics.length === 0 || topics.includes(topic)) listener();
  };
  listeners.add(wrapped);
  return () => {
    listeners.delete(wrapped);
  };
}
