// One keystroke, one action — even when a host mounts two app surfaces.
//
// The workspace installs its shortcuts on `window` (they must work with focus
// anywhere, including no focus at all). That is correct for the standalone app,
// where exactly one App is mounted in the document. A host that embeds the
// library can keep TWO surfaces alive at once, and then every surface saw the
// same keystroke: one shift+E opened an archive dialog in each surface, and one
// "c" opened two new-session flows.
//
// A scope makes the surfaces agree on which one of them owns a keystroke:
//
//   1. The surface that contains the key event target owns it.
//   2. Failing that, the surface that contains the focused element.
//   3. Failing that (focus on <body>, which is the common case for a bare
//      keystroke), the surface the user touched last, else the newest one.
//
// With a single scope registered, `owns` is always true, so the standalone app
// keeps its exact previous behavior.

export type ShortcutScope = {
  /** True when this scope must act on the event. */
  owns: (event: Event) => boolean;
  /** Unregister. Call from the effect cleanup that installed the listener. */
  release: () => void;
};

type Entry = { root: () => Element | null };

const scopes: Entry[] = [];
let lastTouched: Entry | null = null;
let listening = false;

function holds(entry: Entry, node: Node | null): boolean {
  if (!node) return false;
  const root = entry.root();
  return !!root && root.contains(node);
}

function sole(node: Node | null): Entry | null {
  if (!node) return null;
  const hits = scopes.filter((entry) => holds(entry, node));
  return hits.length === 1 ? hits[0]! : null;
}

function noteTouch(event: Event) {
  const hit = sole(event.target as Node | null);
  if (hit) lastTouched = hit;
}

function listen() {
  if (listening || typeof document === "undefined") return;
  // Capture, so a surface that stops propagation internally still updates the
  // owner. Passive: this only reads which subtree was touched.
  document.addEventListener("pointerdown", noteTouch, { capture: true, passive: true });
  document.addEventListener("focusin", noteTouch, { capture: true });
  listening = true;
}

function unlisten() {
  if (!listening || typeof document === "undefined") return;
  document.removeEventListener("pointerdown", noteTouch, { capture: true });
  document.removeEventListener("focusin", noteTouch, { capture: true });
  listening = false;
}

/**
 * Register a surface that installs document-global shortcuts.
 *
 * `getRoot` is read lazily on every check, so it can return the element of a
 * ref that is not attached yet when the effect runs.
 */
export function claimShortcutScope(getRoot: () => Element | null): ShortcutScope {
  const entry: Entry = { root: getRoot };
  scopes.push(entry);
  listen();
  return {
    owns(event: Event) {
      // The standalone app, and any host with one surface: nothing to arbitrate.
      if (scopes.length <= 1) return true;
      const byTarget = sole(event.target as Node | null);
      if (byTarget) return byTarget === entry;
      const active = typeof document !== "undefined" ? document.activeElement : null;
      if (active && active !== document.body) {
        const byFocus = sole(active);
        if (byFocus) return byFocus === entry;
      }
      const fallback = lastTouched && scopes.includes(lastTouched)
        ? lastTouched
        : scopes[scopes.length - 1];
      return fallback === entry;
    },
    release() {
      const index = scopes.indexOf(entry);
      if (index >= 0) scopes.splice(index, 1);
      if (lastTouched === entry) lastTouched = null;
      if (!scopes.length) unlisten();
    },
  };
}

/** Test-only reset. */
export function __resetShortcutScopes() {
  scopes.length = 0;
  lastTouched = null;
  unlisten();
}
