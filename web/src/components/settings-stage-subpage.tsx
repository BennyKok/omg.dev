import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

/** Settings pages that open in the desktop stage. Terminal and Computer are not here: they fill the screen. */
export const SETTINGS_STAGE_SUBPAGES: ReadonlySet<string> = new Set([
  "storage",
  "instructions",
  "connectors",
  "more",
  "usage",
  "changelog",
]);

/** A Settings page in the desktop stage: Back to Settings, then the page in one column. */
export function SettingsStageSubpage({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl pb-10" data-settings-stage-subpage>
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to Settings"
        className="mb-2 flex h-8 items-center gap-0.5 rounded-full pr-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Settings
      </button>
      {children}
    </div>
  );
}
