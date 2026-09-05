import type { Virtualizer } from "@tanstack/react-virtual";

/** Replace estimates without leaving mounted rows at estimated heights mid-scroll. */
export function remeasureChatRows(
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  container: HTMLDivElement | null,
): void {
  virtualizer.measure();
  // Rebuild offsets before resizeItem compares a DOM height with its estimate.
  virtualizer.getTotalSize();
  if (!container) return;
  for (const row of container.querySelectorAll<HTMLElement>("[data-index]")) {
    // Keep ResizeObserver registration, but do not rely on measureElement's
    // synchronous path: TanStack skips it while a keyboard/follow scroll runs.
    // Unchanged rows will not emit another resize after their cache was cleared.
    virtualizer.measureElement(row);
    virtualizer.resizeItem(Number(row.dataset.index), row.offsetHeight);
  }
}
