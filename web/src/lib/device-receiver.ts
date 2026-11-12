import { useSyncExternalStore } from "react";
import { receiverRequest, type ReceiverState } from "./linked-devices";

type Snapshot = { state: ReceiverState | null; error: string | null };
const EMPTY: Snapshot = { state: null, error: null };
let snapshot = EMPTY;
let revision = 0;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

function publish(next: Snapshot) {
  revision++;
  snapshot = next;
  for (const listener of listeners) listener();
}

function watch() {
  const abort = new AbortController();
  let events: EventSource | null = null;
  let reading = false;
  const refresh = async () => {
    if (reading || events?.readyState === 1) return;
    reading = true;
    const before = revision;
    try {
      const state = await receiverRequest(undefined, {}, abort.signal);
      if (abort.signal.aborted || before !== revision) return;
      publish({ state, error: null });
      if (!events && typeof EventSource !== "undefined") {
        events = new EventSource("/api/devices/_local/events");
        events.onmessage = (event) => {
          if (abort.signal.aborted) return;
          try { publish({ state: JSON.parse(event.data), error: null }); }
          catch { publish({ state: null, error: "Cannot read device activity. Reopen Linked devices." }); }
        };
        events.onerror = () => {
          if (!abort.signal.aborted) publish({ state: null, error: "Device connection lost. Reconnecting…" });
        };
      }
    } catch (e) {
      if (!abort.signal.aborted && before === revision) publish({ state: null, error: e instanceof Error ? e.message : String(e) });
    } finally { reading = false; }
  };
  void refresh();
  // Fallback for older servers/browsers. Never gate on tab visibility.
  const timer = window.setInterval(() => void refresh(), 3000);
  document.addEventListener("visibilitychange", refresh);
  return () => {
    abort.abort(); events?.close(); window.clearInterval(timer);
    document.removeEventListener("visibilitychange", refresh);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stop) stop = watch();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { stop?.(); stop = null; snapshot = EMPTY; revision++; }
  };
}

/** One stream across Settings and the app-wide incoming-request indicator. */
export function useDeviceReceiver() {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}

export async function changeDeviceReceiver(action: string, body: Record<string, unknown> = {}) {
  const before = ++revision;
  try {
    const state = await receiverRequest(action, body);
    if (revision === before) publish({ state, error: null });
  } catch (e) {
    // Invalidate controls when a mutation could not reach the receiver.
    publish({ state: null, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export function controllerSessionUrl(server: string | null, session: string | undefined): string | null {
  if (!server || !session) return null;
  try {
    const url = new URL(server);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.pathname = "/"; url.search = ""; url.hash = "";
    url.searchParams.set("session", session);
    return url.href;
  } catch { return null; }
}
