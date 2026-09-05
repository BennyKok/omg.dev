import "../test-support/render";
import { expect, test } from "bun:test";
import { Virtualizer } from "@tanstack/react-virtual";
import { remeasureChatRows } from "./remeasure-chat-rows";

test("metric resets retain real row heights during keyboard and arrival scrolling", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const rows = [180, 520, 110].map((height, index) => {
    const row = document.createElement("div");
    row.dataset.index = String(index);
    Object.defineProperty(row, "offsetHeight", { configurable: true, value: height });
    container.appendChild(row);
    return row;
  });
  let scrollWrites = 0;
  const virtualizer = new Virtualizer<HTMLDivElement, Element>({
    count: 4,
    getScrollElement: () => container,
    estimateSize: () => 40,
    scrollToFn: () => { scrollWrites++; },
    observeElementRect: () => () => {},
    observeElementOffset: () => () => {},
    initialRect: { width: 390, height: 700 },
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;
  try {
    virtualizer.getTotalSize();
    rows.forEach((row) => virtualizer.measureElement(row));
    expect(virtualizer.getTotalSize()).toBe(850);

    // Keyboard/follow scrolling makes TanStack skip synchronous measurements.
    // A metrics reset changes no DOM boxes, so RO need not fire again.
    virtualizer.isScrolling = true;
    virtualizer.measure();
    rows.forEach((row) => virtualizer.measureElement(row));
    expect(virtualizer.getTotalSize()).toBe(160);

    for (const scrolling of [true, false, true]) {
      virtualizer.isScrolling = scrolling;
      remeasureChatRows(virtualizer, container);
      expect(virtualizer.getTotalSize()).toBe(850);
      expect(Array.from({ length: 4 }, (_, index) => virtualizer.measurementsCache[index].start)).toEqual([0, 180, 700, 810]);
    }

    // Streaming/new content grows while the keyboard is moving.
    Object.defineProperty(rows[1], "offsetHeight", { value: 650 });
    remeasureChatRows(virtualizer, container);
    expect(virtualizer.getTotalSize()).toBe(980);
    expect(virtualizer.measurementsCache[2].start).toBe(830);
    expect(scrollWrites).toBe(0);
  } finally {
    container.remove();
    virtualizer.measureElement(null);
  }
});
