/**
 * THE UPDATES PILL, AND THE SHEET BEHIND IT.
 *
 * The web copy of mobile/src/omg/findings-pill.tsx.
 *
 * Open findings used to be a group at the end of the phone's session list,
 * one row per agent, under a header reading "Auto". That put more work at the
 * bottom of a list that is already about work, and every finding pushed the
 * sessions that are actually running further off the fold. iOS answered this
 * with a small pill and a drawer; this is the same answer here.
 *
 * THE PILL floats above the composer, centred, with a quiet count labelled
 * "updates". It draws nothing when there is nothing open, which is the rule
 * the old group followed too.
 *
 * THE SHEET is the same bottom sheet the rest of the phone UI uses, holding
 * the same rows the group showed, so a finding looks the same here as it did
 * in the list.
 */
import { type ReactNode } from "react";
import { Drawer as VaulDrawer } from "vaul";
import { ChevronUp } from "lucide-react";

/**
 * The pill's height and the gap it keeps above the composer.
 *
 * Exported because the list has to reserve this space as well. The pill
 * floats OVER the list, so a list that only clears the composer leaves its
 * last row permanently underneath with no way to scroll it out. The
 * clearance and the placement have to come from one number or they drift.
 */
export const FINDINGS_PILL_HEIGHT_REM = 1.75;
export const FINDINGS_PILL_GAP_REM = 0.5;

/** Where the pill sits, given whether the inline composer is on screen. */
export function findingsPillBottom(aboveComposer: boolean): string {
  return aboveComposer
    ? `calc(var(--lfg-inline-composer-height, var(--lfg-composer-clear)) + ${FINDINGS_PILL_GAP_REM}rem)`
    : `calc(var(--lfg-safe-bottom) + ${FINDINGS_PILL_GAP_REM}rem)`;
}

export function findingsLabel(count: number): string {
  return `${count} update${count === 1 ? "" : "s"}`;
}

export function FindingsPill({
  count,
  onOpen,
  aboveComposer,
}: {
  count: number;
  onOpen: () => void;
  aboveComposer: boolean;
}) {
  if (!count) return null;
  const label = findingsLabel(count);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[56] flex justify-center px-4"
      style={{ bottom: findingsPillBottom(aboveComposer) }}
    >
      <button
        type="button"
        onClick={onOpen}
        data-testid="findings-pill"
        aria-label={`${label} from auto agents. Open`}
        className="pointer-events-auto flex h-7 items-center gap-1.5 rounded-full border border-border/70 bg-card/90 px-2.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-xl transition-colors hover:text-foreground"
      >
        <span className="tabular-nums">{label}</span>
        <ChevronUp className="size-3 shrink-0 opacity-70" />
      </button>
    </div>
  );
}

export function FindingsSheet({
  open,
  onOpenChange,
  count,
  actions,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  /** Clear and triage, which the old group header carried. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <VaulDrawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <VaulDrawer.Portal>
        <VaulDrawer.Overlay className="fixed inset-0 z-[179] bg-black/[0.28]" />
        <VaulDrawer.Content
          data-slot="findings-sheet"
          aria-describedby={undefined}
          // Anchored at the bottom edge, not inset from it: vaul dismisses
          // with translate3d(0, 100%, 0), 100% of this element's own height,
          // so an element held off the bottom stops that far short and leaves
          // a sliver on screen. The float is the padding plus the card.
          data-vaul-custom-container="true"
          className="fixed inset-x-0 bottom-0 z-[180] flex max-h-[80dvh] flex-col bg-transparent px-2 pb-[max(var(--lfg-safe-bottom),0.5rem)] outline-none"
        >
          <div className="mx-auto flex min-h-0 w-full max-w-[414px] flex-col rounded-[2rem] border border-border bg-popover px-3 pb-3 text-popover-foreground shadow-2xl">
            <div className="mx-auto mb-1 mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
            <div className="flex min-h-11 items-baseline gap-2 px-1">
              <VaulDrawer.Title className="text-[17px] font-semibold">Updates</VaulDrawer.Title>
              <span className="text-[13px] tabular-nums text-muted-foreground">{count} open</span>
              {actions ? <span className="ml-auto self-center">{actions}</span> : null}
            </div>
            <div className="-mx-1 flex min-h-0 flex-col gap-1 overflow-y-auto px-1 pb-1 pt-1">
              {children}
            </div>
          </div>
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulDrawer.Root>
  );
}
