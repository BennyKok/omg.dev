import { ChevronDown, Lock } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { HapticTap } from "./haptic-tap";
import { useEmbeddedHostOptions } from "../lib/embedded-host-options";
import { useModelPrices } from "../lib/use-model-prices";
import { OMG_LEVEL_MODELS, isOmgLevelModel } from "../../../src/omg-models";
import { omgModelLabel } from "../../../packages/protocol/src/omg-model-display";

/**
 * True when the composer should carry the level menu: the omg agent is on a
 * level (Auto, Max, Balanced or Fast) and its list offers the levels. A person
 * who chose a specific model in the full picker keeps that choice without a
 * level menu beside it.
 */
export function showOmgLevelMenu(model: string, models: readonly string[]): boolean {
  return isOmgLevelModel(model) && OMG_LEVEL_MODELS.every((level) => models.includes(level));
}

/**
 * The omg agent's levels, one tap from the composer. The full model list stays
 * in the agent picker.
 */
export function OmgLevelMenu({
  value,
  onChange,
}: {
  value: string;
  onChange: (model: string) => void;
}) {
  const { prices } = useModelPrices(true);
  const { onPlanLimit } = useEmbeddedHostOptions();
  const choose = (next: string) => {
    if (next === value) return;
    if (prices[next]?.available === false) {
      const message = `Upgrade your plan to use ${omgModelLabel(next)}.`;
      if (onPlanLimit) onPlanLimit({ message, action: "select-model" });
      else toast.error(message);
      return;
    }
    onChange(next);
  };
  const label = omgModelLabel(value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Model level: ${label}`}
            title="Model level"
            className="relative flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm font-medium text-foreground/80 transition hover:text-foreground"
          />
        }
      >
        <span>{label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        <HapticTap />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (typeof next === "string") choose(next);
          }}
        >
          {OMG_LEVEL_MODELS.map((level) => {
            const locked = prices[level]?.available === false;
            return (
              <DropdownMenuRadioItem key={level} value={level} closeOnClick>
                <span className={cn("flex-1", locked && "text-muted-foreground")}>{omgModelLabel(level)}</span>
                {locked ? <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Upgrade required" /> : null}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
