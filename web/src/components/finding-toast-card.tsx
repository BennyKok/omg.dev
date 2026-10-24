// The toast that announces a new finding from an auto agent.
//
// It is drawn with toast.custom, and a custom toast gets no frame from the
// toaster that shows it. On its own page LFG's toaster supplied padding and a
// background; inside omg.dev the host's toaster shows it, and there the
// content ran edge to edge (the icon on the left border, View on the right
// one). So this card carries its whole look, and index.css leaves the slot
// around it bare (.lfg-finding-toast).

import { Sparkles } from "lucide-react";

export function FindingToastCard({ agentName, title, onOpen }: { agentName: string; title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pointer-events-auto flex w-full min-w-0 items-center gap-2.5 rounded-2xl border border-border bg-popover px-3 py-2.5 text-left text-popover-foreground shadow-lg"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
        <Sparkles className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-snug">{agentName} responded</span>
        <span className="block truncate text-[12px] leading-snug text-muted-foreground">{title}</span>
      </span>
      <span className="shrink-0 rounded-lg bg-primary px-2.5 py-1 text-[12px] font-medium text-white">View</span>
    </button>
  );
}
