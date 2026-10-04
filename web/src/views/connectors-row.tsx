import { ChevronRight, Shield } from "lucide-react";

// Kept apart from connectors-page so Settings can render this row without
// pulling the whole Connectors page into the eager bundle. The page itself is
// loaded on demand from App.tsx.
/** The Settings row that opens this page. */
export function ConnectorsRow({ onOpen, roleCount }: { onOpen: () => void; roleCount: number | null }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left transition-colors duration-150 ease-ios hover:bg-foreground/[0.03] active:bg-foreground/[0.06]"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-muted text-foreground/70">
          <Shield className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">Roles &amp; tool access</span>
          <span className="block truncate text-xs text-muted-foreground">
            {roleCount === null ? "Which tools each session may use" : `${roleCount} role${roleCount === 1 ? "" : "s"}`}
          </span>
        </span>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
    </button>
  );
}
