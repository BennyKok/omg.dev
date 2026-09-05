import { MessageSquare } from "lucide-react";
import { useRuntimeAvailability, runtimeErrorMessage } from "../lib/runtime-availability";

export function RuntimeRecovery() {
  const { loading, ready, status, error, retry } = useRuntimeAvailability();
  if (ready && status === "live" && !error) return null;
  return (
    <div role="status" className="mx-4 flex items-center gap-2 py-1 text-xs text-muted-foreground">
      <span title={error ? runtimeErrorMessage(error) : undefined}>{loading || status === "connecting" ? "Connecting…" : status === "reconnecting" ? "Reconnecting…" : "Connection unavailable"}</span>
      {!loading && <button type="button" onClick={retry} className="rounded px-2 py-2 underline underline-offset-4 hover:text-foreground">Retry</button>}
    </div>
  );
}

export function RuntimeEmptyState() {
  const { ready, status, error } = useRuntimeAvailability();
  // The header owns connection feedback. An unknown list is not an empty list.
  if (!ready || status !== "live" || error) return null;
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 px-4 text-center" role="status">
      <MessageSquare className="size-8 text-muted-foreground/45" aria-hidden />
      <span className="text-sm font-medium text-muted-foreground">No running sessions</span>
    </div>
  );
}
