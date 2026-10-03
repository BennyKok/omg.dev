// A display preference the box owns, with a device-local fallback.
//
// The box stores the value in /api/settings, so every client (this browser,
// another browser, the iOS app) reads the same answer. Until the box is
// connected, or when the box is an older build with no such setting, the
// value lives in this browser's localStorage as it always did.
//
// One store per preference. It owns the cached value, the subscriber list,
// the write path, and the one-time move of an old local value to the box.

export type ServerBackedPref<T> = {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
  /**
   * Adopt the box's value and send later writes to the box.
   *
   * `serverValue` is what the box has stored. `isDefault` says whether that
   * is still the untouched default. A local value from before the box owned
   * this setting is moved up once, only when the box has nothing of its own,
   * and is removed from this browser after the box accepts it.
   */
  connect(serverValue: T, isDefault: boolean, write: (value: T) => Promise<unknown>): void;
  /** Go back to the device-local value. For an older box, and for tests. */
  disconnect(): void;
};

export function createServerBackedPref<T>(options: {
  storageKey: string;
  defaults: T;
  parse: (raw: unknown) => T;
}): ServerBackedPref<T> {
  const { storageKey, defaults, parse } = options;
  let cache: T | null = null;
  let writer: ((value: T) => Promise<unknown>) | null = null;
  // Writes the box has not answered yet. A settings answer that lands while
  // one is in flight is older than the local value, so it is not adopted.
  let pending = 0;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const readLocal = (): T | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? parse(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  };

  const removeLocal = () => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {}
  };

  const adopt = (value: T) => {
    if (cache !== null && JSON.stringify(cache) === JSON.stringify(value)) return;
    cache = value;
    notify();
  };

  const send = (value: T) => {
    const write = writer;
    if (!write) return;
    pending += 1;
    void write(value)
      .catch(() => {})
      .finally(() => {
        pending -= 1;
      });
  };

  const store: ServerBackedPref<T> = {
    get() {
      if (cache === null) cache = readLocal() ?? defaults;
      return cache;
    },
    set(next) {
      cache = next;
      if (writer) {
        send(next);
      } else {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {}
      }
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    connect(serverValue, isDefault, write) {
      const firstConnect = writer === null;
      writer = write;
      if (firstConnect) {
        const local = readLocal();
        if (local !== null && isDefault) {
          // Move the old browser-only value up to the box once.
          adopt(local);
          pending += 1;
          void write(local)
            .then(removeLocal, () => {})
            .finally(() => {
              pending -= 1;
            });
          return;
        }
        // The box already has its own value, so it wins.
        if (local !== null) removeLocal();
      }
      if (pending > 0) return;
      adopt(serverValue);
    },
    disconnect() {
      writer = null;
      pending = 0;
      adopt(readLocal() ?? defaults);
    },
  };

  // Keep tabs in sync while the value is still device-local.
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key !== storageKey || writer) return;
      adopt(readLocal() ?? defaults);
    });
  }

  return store;
}
