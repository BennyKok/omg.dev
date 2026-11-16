/**
 * The chat list's top level when it holds chats from more than one computer.
 *
 *   v This computer            3 working
 *       lfg
 *         Triage 21 auto findings
 *   > studio                   1 working
 *
 * A chat from a linked computer used to sit in the same folder groups as the
 * local chats, marked only by a small name chip on its row. With two
 * computers that share a folder name the reader could not see where a group
 * of chats ran. The computer is a level above the folders now, and each one
 * closes to a single line.
 *
 * Pure and DOM-free, so the split, the order and the saved state are tested
 * without mounting the list.
 */

export const LOCAL_COMPUTER_ID = "local";

export type ComputerGroup<T> = {
  /** "local", or the linked computer's id. */
  id: string;
  name: string;
  items: T[];
};

/**
 * Split the list's roots by the computer that runs them. This computer is
 * first, then the linked computers by name. Returns ONE group when every
 * chat is local, so a single-computer list gains no extra level.
 */
export function groupByComputer<T>(
  items: readonly T[],
  peerOf: (item: T) => { id: string; name: string } | null,
  localName: string,
): ComputerGroup<T>[] {
  const local: ComputerGroup<T> = { id: LOCAL_COMPUTER_ID, name: localName, items: [] };
  const peers = new Map<string, ComputerGroup<T>>();
  for (const item of items) {
    const peer = peerOf(item);
    if (!peer) {
      local.items.push(item);
      continue;
    }
    let group = peers.get(peer.id);
    if (!group) {
      group = { id: peer.id, name: peer.name || peer.id, items: [] };
      peers.set(peer.id, group);
    }
    group.items.push(item);
  }
  const linked = [...peers.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return [local, ...linked];
}

/** True when the list needs the computer level at all. */
export function hasSeveralComputers<T>(groups: readonly ComputerGroup<T>[]): boolean {
  return groups.length > 1;
}

const CLOSED_KEY = "lfg_computer_groups_closed";

/** The computers the reader closed. Open is the default. */
export function readClosedComputers(storage: Pick<Storage, "getItem"> | null): Set<string> {
  try {
    const raw = storage?.getItem(CLOSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeClosedComputers(storage: Pick<Storage, "setItem"> | null, closed: ReadonlySet<string>): void {
  try {
    storage?.setItem(CLOSED_KEY, JSON.stringify([...closed].sort()));
  } catch {
    // Private mode: the choice lasts until the page reloads.
  }
}
