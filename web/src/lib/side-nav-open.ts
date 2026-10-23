/**
 * Whether the phone side navigation is open.
 *
 * This lives outside React state on purpose. It used to be a `useState` in
 * `App`, so every open and close rendered the whole app shell again before the
 * drawer could start to move. On a phone that was a visible pause between the
 * tap and the slide. Now only the drawer subscribes, and a tap renders the
 * drawer alone.
 *
 * One store per App instance, never one per module. A host can mount two
 * surfaces from this bundle at once (omg.dev keeps its Settings surface alive
 * beside the Computer surface), and each one renders its own phone drawer
 * through a body-level panel that escapes the host's `display: none`. A
 * module-wide flag opened both: the hidden Settings surface's drawer, which has
 * none of the host's rows, slid in on top of the real one.
 */
import { useSyncExternalStore } from "react";

export interface SideNavOpenStore {
  get(): boolean;
  set(next: boolean): void;
  subscribe(listener: () => void): () => void;
}

export function createSideNavOpenStore(): SideNavOpenStore {
  let open = false;
  const listeners = new Set<() => void>();
  return {
    get: () => open,
    set(next) {
      if (open === next) return;
      open = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useSideNavOpen(store: SideNavOpenStore) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
