import { Gauge } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ThinkingBar, type SetupChoice } from "./agent-setup-sheet";

/**
 * The bottom of the desktop composer's model picker. Thinking and Fast live
 * here instead of as pills beside the picker, so the composer toolbar stays
 * on one row.
 */
export function ComposerPickerFooter({
  thinking,
  fast,
}: {
  thinking: { options: SetupChoice[]; onPick: (id: string) => void } | null;
  fast: { enabled: boolean; onToggle: () => void } | null;
}) {
  if (!thinking && !fast) return null;
  return (
    <div className="space-y-3">
      {thinking ? (
        <div className="space-y-2">
          <span className="text-xs font-medium text-muted-foreground">Thinking</span>
          <ThinkingBar compact options={thinking.options} onPick={thinking.onPick} />
        </div>
      ) : null}
      {fast ? (
        <div className="flex items-center gap-2">
          <Gauge
            className={cn("size-4 shrink-0", fast.enabled ? "text-sky-500" : "text-muted-foreground")}
            aria-hidden="true"
          />
          <span
            className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground"
            title="Faster replies. Thinking stays the same."
          >
            Fast mode
          </span>
          <Switch
            aria-label="Fast mode"
            checked={fast.enabled}
            onCheckedChange={() => fast.onToggle()}
            className="h-5 w-9 [&>span]:size-4 [&>span]:data-[checked]:translate-x-4"
          />
        </div>
      ) : null}
    </div>
  );
}
