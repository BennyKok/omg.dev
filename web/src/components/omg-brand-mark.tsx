import { useId } from "react";

import { cn } from "@/lib/utils";

/**
 * The omg.dev mark: a disc with a bite taken out of the upper right.
 *
 * Drawn in `currentColor` rather than a baked hex so one component covers both
 * builds. The hosted product wears it in the brand orange; a locally hosted
 * runtime wears the same shape in muted grey (see `ProductBrand`), which is how
 * you can tell at a glance which one you are looking at. It used to be a hard
 * `#ff5530`, so the only way to say "local" was to show a different logo
 * entirely — that is what the old LFG mark was doing here.
 */
export function OmgBrandMark({ className }: { className?: string }) {
  const maskId = useId();
  return (
    <svg
      viewBox="0 0 100 100"
      className={cn("size-6 shrink-0", className)}
      aria-hidden
    >
      <mask id={maskId}>
        <rect width="100" height="100" fill="white" />
        <circle cx="71" cy="29" r="14" fill="black" />
      </mask>
      <circle
        cx="50"
        cy="50"
        r="44"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}

/**
 * The colour the mark and wordmark take, by build.
 *
 * Hosted is the brand orange. Local is muted grey — the same product, running
 * on your own machine, said quietly rather than said with a different logo.
 */
export function omgBrandToneClass(hosted: boolean): string {
  return hosted ? "text-[#ff5530]" : "text-muted-foreground";
}
