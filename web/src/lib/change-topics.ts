import type { ChangeTopic } from "../useLiveSocket";

/**
 * List changes the server announced on the live socket (`changed` frames),
 * for lists kept outside App: the questions inbox and threads.
 *
 * While the socket is live, a list re-reads when it changes and otherwise
 * only on a slow backstop, for writes made outside the server. Every Computer
 * the app can reach announces changes (LFG 0.6.260+; hosted Computers are
 * updated before they serve), so there is no fast poll for older servers.
 * While the socket is down, a list polls as before.
 */
type Listener = (topics: ChangeTopic[]) => void;

const listeners = new Set<Listener>();
let live = false;

/** The slow backstop poll for a list while the socket is live. */
export const LIVE_LIST_BACKSTOP_MS = 5 * 60_000;

export function setListsLive(next: boolean): void {
  live = next;
}

export function listsLive(): boolean {
  return live;
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
