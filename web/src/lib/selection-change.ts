// One document-level `selectionchange` listener, shared by every subscriber.
//
// Each rendered message needs to know whether the current selection touches
// its own content, so it can drop `user-select` back to the default and get
// out of the way of the native iOS handles. Registering that listener per
// message made the cost of a single caret move scale with the number of
// mounted messages: `selectionchange` fires continuously while a selection
// handle is dragged, and every message ran its own getSelection() plus two
// `contains()` walks on each event. The transcript is virtualized, so this is
// tens of handlers rather than hundreds, but it is still O(messages) work on
// the highest-frequency event the document produces.
//
// The listener is attached on the first subscriber and removed with the last,
// so a transcript with nothing mounted costs nothing at all.

type Listener = () => void;

const listeners = new Set<Listener>();
let attached = false;

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Run `listener` on every `selectionchange`. Returns the unsubscribe function.
 *
 * The listener receives no argument on purpose: `getSelection()` is a live
 * object, and each subscriber cares about a different question ("does this
 * touch MY node"), so there is nothing useful to pass that the subscriber
 * cannot read itself at the moment it runs.
 */
export function subscribeSelectionChange(listener: Listener): () => void {
  listeners.add(listener);
  if (!attached && typeof document !== "undefined") {
    document.addEventListener("selectionchange", notify);
    attached = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && attached && typeof document !== "undefined") {
      document.removeEventListener("selectionchange", notify);
      attached = false;
    }
  };
}

/** Test seam: how many subscribers are live, and whether the DOM listener is on. */
export function selectionChangeStateForTests(): { subscribers: number; attached: boolean } {
  return { subscribers: listeners.size, attached };
}
