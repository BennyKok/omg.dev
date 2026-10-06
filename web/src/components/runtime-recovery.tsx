import { ArrowDown, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
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
 * The desktop rail's brand lockup, replaced by connection state while the
 * runtime is not live.
 *
 * Mobile already swaps its brand mark for this text, so the desktop rail was
 * the one place that showed a confident product lockup next to a separate,
 * unaligned "Connecting…" line in the flow above it. The line also pushed the
 * whole layout down each time the socket dropped. The status belongs in the
 * space the brand already owns.
 */
export function RuntimeStatusBrand({ children }: { children: ReactNode }) {
  const availability = useRuntimeAvailability();
  const { loading, error, retry } = availability;
  const text = runtimeStatusText(availability);
  if (!text) return <>{children}</>;
  return (
    <button
      type="button"
      role="status"
      onClick={() => {
        if (!loading) retry();
      }}
      aria-label={loading ? text : `${text} Retry connection`}
      title={loading ? text : error ? runtimeErrorMessage(error) : "Retry connection"}
      className="mx-1 inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg pr-1 text-left text-muted-foreground transition-colors hover:text-foreground"
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-current motion-reduce:animate-none"
      />
      <span className="truncate text-[15px] font-semibold leading-none tracking-[-0.02em]">
        {text}
      </span>
    </button>
  );
}

/**
 * The same state for the collapsed rail, which has no room for the lockup or
 * the words. Without this the collapsed rail said nothing at all once the
 * standalone line moved into the brand row.
 */
export function RuntimeStatusDot() {
  const availability = useRuntimeAvailability();
  const { loading, error, retry } = availability;
  const text = runtimeStatusText(availability);
  if (!text) return null;
  return (
    <button
      type="button"
      role="status"
      onClick={() => {
        if (!loading) retry();
      }}
      aria-label={loading ? text : `${text} Retry connection`}
      title={loading ? text : error ? runtimeErrorMessage(error) : "Retry connection"}
      className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full bg-current animate-pulse motion-reduce:animate-none"
      />
    </button>
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
