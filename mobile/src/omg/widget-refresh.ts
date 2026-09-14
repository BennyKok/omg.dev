/** One serialized writer for widget snapshots, including failed wake-up requests. */
export function widgetRefresh(options: {
  refresh(): Promise<boolean>;
  onError(error: unknown): void;
  schedule?(run: () => void, delay: number): () => void;
}) {
  const schedule = options.schedule ?? ((run, delay) => {
    const timer = setTimeout(run, delay);
    return () => clearTimeout(timer);
  });
  let disposed = false;
  let foreground = false;
  let queued = false;
  let pending: Promise<void> | null = null;
  let cancelTimer: (() => void) | null = null;
  let scheduledSoon = false;
  const cancel = () => { cancelTimer?.(); cancelTimer = null; };
  const later = (delay: number) => {
    cancel();
    scheduledSoon = delay === 500;
    if (foreground && !disposed) cancelTimer = schedule(() => { cancelTimer = null; void refresh(); }, delay);
  };
  const refresh = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    cancel();
    if (pending) { queued = true; return pending; }
    pending = Promise.resolve().then(async () => {
      if (disposed) return;
      let succeeded = false;
      do {
        queued = false;
        try { succeeded = await options.refresh(); }
        catch (error) { options.onError(error); succeeded = false; }
      } while (queued && !disposed);
      // Reconcile asks and membership even if a live frame is missed.
      later(succeeded ? 30_000 : 5_000);
    }).finally(() => { pending = null; });
    return pending;
  };
  return {
    refresh,
    changed() {
      if (!foreground || disposed) return;
      if (pending) { queued = true; return; }
      if (!cancelTimer || !scheduledSoon) later(500);
    },
    foreground(active: boolean) {
      foreground = active;
      cancel();
      // A final snapshot on departure includes work started in the app.
      return refresh();
    },
    dispose() { disposed = true; queued = false; cancel(); },
  };
}
