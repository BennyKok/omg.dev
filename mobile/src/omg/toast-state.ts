/** Toast semantics and lifetime, independent of the native renderer. */
export type ToastIntent = "info" | "success" | "warning" | "error";
export type ToastOptions = {
  intent: ToastIntent;
  duration?: number;
  /** Passive background failures can stay silent. */
  haptic?: boolean;
};
export type ToastState = { id: number; message: string; intent: ToastIntent; duration: number };
export const TOAST_STATUS = {
  info: { ios: "info.circle.fill", android: "info", haptic: "none" },
  success: { ios: "checkmark.circle.fill", android: "check_circle", haptic: "light" },
  warning: { ios: "exclamationmark.triangle.fill", android: "warning", haptic: "warning" },
  error: { ios: "xmark.circle.fill", android: "error", haptic: "error" },
} as const;
export type ToastFeedback = typeof TOAST_STATUS[ToastIntent]["haptic"];
const NETWORK_ERROR = /network connection was lost|fetch failed|network request failed|failed to fetch|econnre|etimedout|timed out|could not connect|no internet|offline|socket hang up|load failed/i;
export function plainMessage(raw: string): string {
  const text = raw.trim();
  if (NETWORK_ERROR.test(text)) return "Connection lost. Check your network and try again.";
  return text.replace(/\s*\(at [^)]+\.(swift|kt|java|ts|tsx|js):\d+\)\s*$/i, "").trim();
}
export function createToastController(feedback: (kind: ToastFeedback) => void) {
  let state: ToastState | null = null;
  let sequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: ToastState | null) => { state = next; listeners.forEach(fn => fn()); };
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const dismiss = (id?: number) => {
    if (id !== undefined && state?.id !== id) return;
    clearTimer(); publish(null);
  };
  const resume = (id?: number) => {
    if (!state || (id !== undefined && state.id !== id)) return;
    clearTimer();
    const current = state;
    timer = setTimeout(() => dismiss(current.id), current.duration);
  };
  return {
    snapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    show(raw: string, options: ToastOptions): number | undefined {
      const message = options.intent === "error" ? plainMessage(raw) : raw.trim();
      if (!message) return;
      // A repeat of the visible toast must not vibrate or replay the entrance
      // twice, but it does restart the clock so the banner stays readable.
      if (state?.message === message && state.intent === options.intent) {
        resume(state.id);
        return state.id;
      }
      const words = message.split(/\s+/).length;
      const duration = Math.max(1000, options.duration ?? Math.min(7000, Math.max(2200, 900 + words * 350)));
      const next = { id: ++sequence, message, intent: options.intent, duration };
      clearTimer(); publish(next); resume(next.id);
      const kind = TOAST_STATUS[options.intent].haptic;
      if (options.haptic !== false && kind !== "none") feedback(kind);
      return next.id;
    },
    dismiss,
    pause(id: number) { if (state?.id === id) clearTimer(); },
    resume,
    reset() { clearTimer(); publish(null); },
  };
}
