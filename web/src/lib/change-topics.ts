import type { ChangeTopic } from "../useLiveSocket";

/**
 * List changes the server announced on the live socket (`changed` frames),
 * for lists kept outside App: the questions inbox and threads.
 *
 * While the socket is live and its server announces changes, a list re-reads
 * when it changes and polls only as a slow backstop, for writes made outside
 * the server. Otherwise it polls as it always did.
 */
type Listener = (topics: ChangeTopic[]) => void;

const listeners = new Set<Listener>();
let announced = false;

/** The slow backstop poll for an announced list. */
export const ANNOUNCED_LIST_BACKSTOP_MS = 5 * 60_000;

export function setListChangesAnnounced(next: boolean): void {
  announced = next;
}

export function listChangesAnnounced(): boolean {
  return announced;
}

export function emitListChanges(topics: ChangeTopic[]): void {
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
