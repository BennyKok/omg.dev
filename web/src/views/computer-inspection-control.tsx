import { Loader2, ScanSearch, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ComputerInspectionSession = {
  sessionId: string;
  title: string;
  project: string;
};

function targetLabel(session: ComputerInspectionSession): string {
  return session.title?.trim() || session.project?.trim() || "Current session";
}

export function ComputerInspectionControl({
  active,
  starting = false,
  session,
  onStart,
  onCancel,
}: {
  active: boolean;
  starting?: boolean;
  session: ComputerInspectionSession;
  onStart: () => void;
  onCancel: () => void;
}) {
  const label = targetLabel(session);

  if (active) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="h-auto max-w-[calc(100vw-1.5rem)] gap-2 rounded-2xl px-3 py-2 shadow-xl"
        onClick={onCancel}
        aria-label={`Cancel element selection for ${label}`}
        title="Cancel and return to the session"
      >
        <ScanSearch className="size-4 shrink-0 text-cyan-500" aria-hidden="true" />
        <span className="min-w-0 text-left leading-tight">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Selecting for this session
          </span>
          <span className="block truncate text-xs font-semibold">{label}</span>
        </span>
        <X className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <Button
      variant="brand-soft"
      size="sm"
      className="h-auto max-w-[calc(100vw-1.5rem)] gap-2 rounded-2xl px-3 py-2 shadow-xl"
      disabled={starting}
      onClick={onStart}
      aria-label={`${starting ? "Preparing element selection" : "Select an element"} for ${label}`}
      title={starting ? "Preparing Computer Design Mode" : "Select an element for this session"}
    >
      {starting ? (
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        <ScanSearch className="size-4 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 text-left leading-tight">
        <span className="block text-[10px] font-medium uppercase tracking-wide text-foreground/55">
          {starting ? "Preparing selection" : "Select element for"}
        </span>
        <span className="block truncate text-xs font-semibold">{label}</span>
      </span>
    </Button>
  );
}
