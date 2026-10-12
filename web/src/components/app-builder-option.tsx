import { Check, Lock, Sparkles } from "lucide-react";
import { cn } from "../lib/utils";

export type BuilderChoice = { selected: boolean; disabled?: boolean; onChoose(): void };

/** A workflow choice in the model list. The composer owns its launch state. */
export function AppBuilderOption({ selected, onChoose, disabled = false, locked = false }: BuilderChoice & { locked?: boolean }) {
  return <button type="button" onClick={onChoose} disabled={disabled} aria-pressed={selected} aria-disabled={disabled || locked || undefined}
    className={cn("mb-1 flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-left text-sm outline-none transition-colors",
      selected ? "bg-primary/12 text-foreground ring-1 ring-inset ring-primary/20" : "text-foreground hover:bg-muted focus-visible:bg-muted", disabled && "cursor-not-allowed opacity-60")}>
    <Check className={cn("size-4 shrink-0 text-primary", selected ? "opacity-100" : "opacity-0")} />
    <Sparkles className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span className="min-w-0 flex-1"><span className="block font-medium">App Builder</span>
      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">Haiku · Apex code review · Luna design review</span>
      {disabled ? <span className="mt-1 block text-xs text-muted-foreground">Choose a project to use this workflow.</span> : null}</span>
    {locked ? <Lock className="size-4 shrink-0 text-muted-foreground" aria-label="Upgrade required" /> : null}
  </button>;
}
