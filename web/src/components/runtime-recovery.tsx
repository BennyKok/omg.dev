import { Loader2, MessageSquare } from "lucide-react";
import { useRuntimeAvailability, runtimeErrorMessage } from "../lib/runtime-availability";

export function RuntimeRecovery() {
  const { loading, ready, status, error, retry } = useRuntimeAvailability();
  if (ready && status === "live" && !error) return null;
  return (
    <div role="status" className="mx-3 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">{error ? runtimeErrorMessage(error) : loading || status === "connecting" ? "Connecting to this computer…" : "Connection lost. Reconnecting…"}</span>
      <button type="button" onClick={retry} disabled={loading} className="shrink-0 rounded-lg px-3 py-2 font-medium text-primary disabled:opacity-50">Retry</button>
      <span className="w-full text-xs text-muted-foreground">You can also use the machine menu to choose another computer.</span>
    </div>
  );
}

export function RuntimeEmptyState() {
  const { ready, loading, status, error } = useRuntimeAvailability();
  const available = ready && status === "live" && !error;
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 px-4 text-center" role="status">
      {available ? <MessageSquare className="size-8 text-muted-foreground/45" aria-hidden /> : <Loader2 className="size-8 text-muted-foreground/45 animate-spin" aria-hidden />}
      <span className="text-sm font-medium text-muted-foreground">{available ? "No running sessions" : loading || status === "connecting" ? "Loading sessions…" : "Session list is unavailable"}</span>
    </div>
  );
}

export function ComposerConnectionHint() {
  const { ready, status, error } = useRuntimeAvailability();
  return ready && status === "live" && !error ? null : <p role="status" className="px-2 pb-1 text-xs text-muted-foreground">You can write a draft. Reconnect to start a session.</p>;
}
