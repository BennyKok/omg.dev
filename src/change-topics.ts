import type { OmgChangeTopic } from "../packages/protocol/src/index.ts";

/**
 * "A list a client shows has changed." Each store announces its own topic from
 * the function that writes it, and the live socket tells open clients, which
 * then re-read only that list. Before this the web app re-read every list
 * every 30 s while its socket was open, because nothing said when one changed.
 *
 * Only writes made by this process are announced. A write from another
 * process (the `lfg agents auto` CLI edits schedules directly) is picked up by
 * the client's slow backstop poll.
 */
export type ChangeTopic = OmgChangeTopic;

const listeners = new Set<(topic: ChangeTopic) => void>();

export function announceChange(topic: ChangeTopic): void {
  for (const listener of listeners) {
    try {
      listener(topic);
    } catch {}
  }
}

export function onChangeAnnounced(listener: (topic: ChangeTopic) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
