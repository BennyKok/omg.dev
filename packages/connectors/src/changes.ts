// One signal: "the connector tools some session sees may have changed".
//
// The store raises it on every write (a connection added, removed, renamed,
// or signed in, since sign-in records the account on the row). The box raises
// it when a role changes, because a role decides which connector tools pass.
// `/mcp/connectors` turns it into `notifications/tools/list_changed` on each
// open stream, so a running agent re-lists instead of keeping the tool set it
// saw at launch. Coarse on purpose: a re-list is one local request.
type Listener = () => void;

const listeners = new Set<Listener>();

export function onConnectorsChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitConnectorsChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One broken stream must not stop the others.
    }
  }
}
