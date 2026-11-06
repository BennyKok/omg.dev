import { useLayoutEffect, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type PartialKeys,
  type VirtualItem,
  type VirtualizerOptions,
} from "@tanstack/react-virtual";

/**
 * A virtual list whose mounted rows sit in NORMAL DOCUMENT FLOW.
 *
 * The stock TanStack layout positions every row absolutely, at an offset the
 * JavaScript model computes from estimated and measured heights. Whenever the
 * model and the real DOM disagree, even for one frame, rows draw over each
 * other: a streamed reply grows, a card or an image settles, a find highlight
 * lands, and the rows under it keep their old offsets until a ResizeObserver
 * callback and a style write catch up. Each of those cases needed its own
 * patch, and a missed one reads as text printed on top of other text.
 *
 * Here the browser lays out the rows it has mounted, so two mounted rows can
 * never overlap whatever the model believes. The model only sizes the gaps
 * that stand in for the rows that are NOT mounted. A wrong estimate can
 * therefore move the scroll position by its error, which the reading anchor
 * in ChatStream already corrects, but it cannot stack text.
 *
 * The row range is allowed to have holes (the transcript keeps its live tail
 * mounted while the reader is far above it), so a gap is emitted wherever two
 * consecutive mounted indexes are not adjacent, plus one before the first row
 * and one after the last.
 */

export type FlowSlot<T = unknown> =
  | { kind: "gap"; key: string; before: number; size: number }
  | { kind: "row"; key: string; item: VirtualItem; data?: T };

/**
 * Turn the mounted virtual items into rows and the gaps between them. Pure:
 * every size comes from the virtualizer's own measurements, so a gap is
 * exactly the space the unmounted rows it replaces would take.
 */
export function flowSlots(items: readonly VirtualItem[], totalSize: number, scrollMargin: number): FlowSlot[] {
  const slots: FlowSlot[] = [];
  // Item offsets include scrollMargin; the container's own content box does not.
  let cursor = 0;
  let nextIndex = 0;
  for (const item of items) {
    const start = item.start - scrollMargin;
    if (item.index !== nextIndex || start !== cursor) {
      slots.push({ kind: "gap", key: `gap:${item.index}`, before: item.index, size: Math.max(0, start - cursor) });
    }
    slots.push({ kind: "row", key: String(item.key), item });
    cursor = item.end - scrollMargin;
    nextIndex = item.index + 1;
  }
  const tail = Math.max(0, totalSize - cursor);
  if (tail > 0 || items.length === 0) {
    slots.push({ kind: "gap", key: "gap:end", before: Number.POSITIVE_INFINITY, size: tail });
  }
  return slots;
}

export type FlowVirtualizer = Virtualizer<HTMLDivElement, Element> & {
  /** Ref for the element that holds the rows and gaps, in flow. */
  containerRef: (node: HTMLElement | null) => void;
};

type Options = PartialKeys<
  VirtualizerOptions<HTMLDivElement, Element>,
  "observeElementRect" | "observeElementOffset" | "scrollToFn"
> & {
  /**
   * Called after a mounted row's measured height changed. In flow layout the
   * browser has already moved every row below it, so this is where the owner
   * of scroll position holds the reader's row still, before paint.
   */
  onItemResize?: () => void;
};

const GAP_ATTR = "data-flow-gap";

/**
 * Same contract as `useVirtualizer` with `directDomUpdates`: a scroll that does
 * not change the mounted range does not re-render the caller. What it writes
 * directly is only the gap heights, never a row's position.
 */
export function useFlowVirtualizer({ onItemResize, ...options }: Options): FlowVirtualizer {
  const rerender = useReducer((x: number) => x + 1, 0)[1];
  const resizeRef = useRef(onItemResize);
  resizeRef.current = onItemResize;
  const state = useRef({
    container: null as HTMLElement | null,
    prevRange: null as { startIndex: number; endIndex: number; isScrolling: boolean } | null,
  });

  const writeGaps = (instance: Virtualizer<HTMLDivElement, Element>) => {
    const container = state.current.container;
    if (!container) return;
    const slots = flowSlots(instance.getVirtualItems(), instance.getTotalSize(), instance.options.scrollMargin);
    const sizes = new Map<string, number>();
    for (const slot of slots) if (slot.kind === "gap") sizes.set(slot.key, slot.size);
    for (const node of container.children) {
      if (!(node instanceof HTMLElement)) continue;
      const key = node.getAttribute(GAP_ATTR);
      if (key == null) continue;
      const size = sizes.get(key);
      // A gap the next render will drop: leave it, React removes it.
      if (size == null) continue;
      const next = `${size}px`;
      if (node.style.height !== next) node.style.height = next;
    }
  };

  const resolved: VirtualizerOptions<HTMLDivElement, Element> = {
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    ...options,
    onChange: (instance, sync) => {
      writeGaps(instance);
      const range = instance.range;
      const prev = state.current.prevRange;
      const changed =
        !prev ||
        prev.isScrolling !== instance.isScrolling ||
        prev.startIndex !== range?.startIndex ||
        prev.endIndex !== range?.endIndex;
      if (changed) {
        state.current.prevRange = range
          ? { startIndex: range.startIndex, endIndex: range.endIndex, isScrolling: instance.isScrolling }
          : null;
        if (sync) flushSync(rerender);
        else rerender();
      }
      options.onChange?.(instance, sync);
    },
  };

  const [instance] = useState(() => {
    const v = new Virtualizer<HTMLDivElement, Element>(resolved);
    // An instance field, not a prototype method, so it can be wrapped; the
    // ResizeObserver path and measureElement both call it through `this`.
    const resizeItem = v.resizeItem;
    v.resizeItem = (index, size) => {
      const before = v.measurementsCache[index]?.size;
      resizeItem(index, size);
      if (before !== undefined && before !== size) resizeRef.current?.();
    };
    return Object.assign(v, {
      containerRef: (node: HTMLElement | null) => {
        state.current.container = node;
      },
    });
  });
  instance.setOptions(resolved);

  useLayoutEffect(() => instance._didMount(), [instance]);
  useLayoutEffect(() => instance._willUpdate());
  // Newly committed rows registered their sizes during this commit.
  useLayoutEffect(() => writeGaps(instance));

  return instance;
}

export const FLOW_GAP_ATTR = GAP_ATTR;
