// A short message at the bottom of the screen, such as "Link copied".
//   toast("Link copied");      <Toaster /> is in routes.tsx once.
import { useEffect, useSyncExternalStore } from "react";

let message: { id: number; text: string } | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string): void {
  message = { id: nextId++, text };
  emit();
}

export function Toaster() {
  const m = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => message,
    () => null,
  );
  useEffect(() => {
    if (!m) return;
    const t = setTimeout(() => {
      if (message?.id === m.id) {
        message = null;
        emit();
      }
    }, 2600);
    return () => clearTimeout(t);
  }, [m]);
  return (
    <div className="toast-host" aria-live="polite">
      {m ? <div key={m.id} className="toast" role="status">{m.text}</div> : null}
    </div>
  );
}
