import { ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SessionComputerInspectionAction({
  sessionId,
  sessionTitle,
  pageUrl = null,
  disabled = false,
  onOpen,
}: {
  sessionId: string;
  sessionTitle: string;
  pageUrl?: string | null;
  disabled?: boolean;
  onOpen: (sessionId: string, pageUrl: string | null) => void | Promise<void>;
}) {
  return (
    <Button
      size="icon"
      type="button"
      variant="tint"
      className="size-10 shrink-0 rounded-full md:size-8"
      onClick={() => onOpen(sessionId, pageUrl)}
      aria-label={`Select an element from Computer for ${sessionTitle}`}
      title="Select element from Computer"
      disabled={disabled}
    >
      <ScanSearch className="size-4" aria-hidden="true" />
    </Button>
  );
}
