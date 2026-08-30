import { ChevronDown, Loader2, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ComputerInspectionSession = {
  sessionId: string;
  title: string;
  project: string;
};

function targetLabel(session: ComputerInspectionSession | undefined): string {
  return session?.title?.trim() || session?.project?.trim() || "Choose an agent";
}

export function ComputerInspectionControl({
  active,
  starting = false,
  sessions = [],
  selectedSessionId = "",
  onSelectedSessionChange = () => {},
  onStart = () => {},
  onCancel,
}: {
  active: boolean;
  starting?: boolean;
  sessions?: ComputerInspectionSession[];
  selectedSessionId?: string;
  onSelectedSessionChange?: (sessionId: string) => void;
  onStart?: () => void;
  onCancel: () => void;
}) {
  if (active) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className="shadow-lg"
        onClick={onCancel}
        aria-label="Cancel element inspection"
        title="Cancel element inspection"
      >
        <ScanSearch className="mr-1.5 size-3.5 text-cyan-500" aria-hidden="true" />
        Inspecting
      </Button>
    );
  }

  const selected = sessions.find((session) => session.sessionId === selectedSessionId);
  const label = targetLabel(selected);
  const unavailable = starting || !selected;

  return (
    <div className="flex max-w-[calc(100vw-1.5rem)] items-center rounded-full bg-card/90 p-1 shadow-xl ring-1 ring-foreground/10 backdrop-blur">
      <Button
        variant="brand-soft"
        size="sm"
        className="max-w-[min(15rem,calc(100vw-5.5rem))] shadow-none"
        disabled={unavailable}
        onClick={onStart}
        aria-label={selected ? `Point an element for ${label}` : "Choose an agent before pointing an element"}
        title={selected ? `Add the selected element to ${label}` : "Choose an agent first"}
      >
        {starting ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <ScanSearch className="size-3.5" aria-hidden="true" />
        )}
        <span>{starting ? "Starting…" : "Point element"}</span>
        {selected ? <span className="hidden truncate text-foreground/55 sm:inline">· {label}</span> : null}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Choose the agent for the selected element"
              title="Choose agent"
              disabled={starting || sessions.length === 0}
            />
          }
        >
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-72 max-w-[calc(100vw-1.5rem)]">
          <DropdownMenuRadioGroup
            value={selectedSessionId}
            onValueChange={(value) => {
              if (typeof value === "string") onSelectedSessionChange(value);
            }}
          >
            <DropdownMenuLabel>Add the selected element to</DropdownMenuLabel>
            {sessions.map((session) => (
              <DropdownMenuRadioItem key={session.sessionId} value={session.sessionId}>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{targetLabel(session)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{session.project}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
