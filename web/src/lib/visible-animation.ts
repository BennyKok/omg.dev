// Share viewport and preference observers across animated decorations. The
// callback owns its timers/frames and must stop them when active becomes false.
type Entry = { visible: boolean; active: boolean; update: (active: boolean) => void };
const entries = new Map<Element, Entry>();
let observer: IntersectionObserver | undefined;
let motion: MediaQueryList | undefined;

function sync(entry: Entry) {
  const active = entry.visible && !document.hidden && !motion?.matches;
  if (active === entry.active) return;
  entry.active = active;
  entry.update(active);
}

function syncAll() {
  for (const entry of entries.values()) sync(entry);
}

export function observeVisibleAnimation(element: Element, update: (active: boolean) => void): () => void {
  if (entries.size === 0) {
    motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    motion?.addEventListener("change", syncAll);
    document.addEventListener("visibilitychange", syncAll);
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver((changes) => {
        for (const change of changes) {
          const entry = entries.get(change.target);
          if (!entry) continue;
          entry.visible = change.isIntersecting;
          sync(entry);
        }
      });
    }
  }
  const entry: Entry = { visible: !observer, active: false, update };
  entries.set(element, entry);
  update(false);
  observer?.observe(element);
  sync(entry);
  return () => {
    observer?.unobserve(element);
    entries.delete(element);
    if (entry.active) update(false);
    if (entries.size === 0) {
      observer?.disconnect();
      observer = undefined;
      motion?.removeEventListener("change", syncAll);
      motion = undefined;
      document.removeEventListener("visibilitychange", syncAll);
    }
  };
}
