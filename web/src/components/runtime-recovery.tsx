import { ArrowDown, MessageSquare } from "lucide-react";
import {
  useRuntimeAvailability,
  runtimeErrorMessage,
  runtimeStatusText,
} from "../lib/runtime-availability";

export function RuntimeRecovery() {
  const availability = useRuntimeAvailability();
  const { loading, error, retry } = availability;
  const text = runtimeStatusText(availability);
  if (!text) return null;
  return (
    <div role="status" className="mx-4 flex items-center gap-2 py-1 text-xs text-muted-foreground">
      <span title={error ? runtimeErrorMessage(error) : undefined}>{text}</span>
      {!loading && <button type="button" onClick={retry} className="rounded px-2 py-2 underline underline-offset-4 hover:text-foreground">Retry</button>}
    </div>
  );
}

/**
 * The phone list with no session rows. The persistent composer at the foot of
 * the screen is the only way to start one, so the copy points at it rather
 * than adding a second button that would just focus the same input.
 */
export function RuntimeEmptyState() {
  const { ready, status, error } = useRuntimeAvailability();
  // The header owns connection feedback. An unknown list is not an empty list.
  if (!ready || status !== "live" || error) return null;
  return (
    <div className="flex min-h-[40dvh] flex-col items-center justify-center gap-2 px-6 text-center" role="status">
      <MessageSquare className="mb-1 size-8 text-muted-foreground/45" aria-hidden />
      <span className="text-base font-semibold text-foreground">No sessions yet</span>
      <span className="text-sm text-muted-foreground">Type below to start one.</span>
      <ArrowDown className="mt-2 size-4 text-muted-foreground/60 motion-safe:animate-bounce" aria-hidden />
    </div>
  );
}
