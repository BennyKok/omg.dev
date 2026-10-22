/**
 * Whether the phone side navigation is open.
 *
 * This lives outside React state on purpose. It used to be a `useState` in
 * `App`, so every open and close rendered the whole app shell again before the
 * drawer could start to move. On a phone that was a visible pause between the
 * tap and the slide. Now only the drawer subscribes, and a tap renders the
 * drawer alone.
 */
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export function setSideNavOpen(next: boolean) {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => open;

export function useSideNavOpen() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
