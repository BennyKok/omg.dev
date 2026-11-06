import { afterEach, expect, test } from "bun:test";
import type { VirtualItem } from "@tanstack/react-virtual";
import { mount, type Mounted } from "../test-support/render";
const { FLOW_GAP_ATTR, flowSlots, useFlowVirtualizer } = await import("./flow-virtualizer");

const item = (index: number, start: number, size: number): VirtualItem => ({
  key: `row-${index}`,
  index,
  start,
  end: start + size,
  size,
  lane: 0,
});

test("a contiguous window gets one gap above and one below", () => {
  const slots = flowSlots([item(3, 300, 100), item(4, 400, 50)], 1000, 0);
  expect(slots.map((s) => (s.kind === "gap" ? `gap ${s.size}` : `row ${s.item.index}`))).toEqual([
    "gap 300",
    "row 3",
    "row 4",
    "gap 550",
  ]);
});

test("a hole between the reading window and the live tail gets its own gap", () => {
  const slots = flowSlots([item(0, 20, 100), item(1, 120, 100), item(8, 900, 80), item(9, 980, 40)], 1000, 20);
  expect(slots.map((s) => (s.kind === "gap" ? `gap ${s.size}` : `row ${s.item.index}`))).toEqual([
    "row 0",
    "row 1",
    "gap 680",
    "row 8",
    "row 9",
  ]);
});

test("the rows plus the gaps always add up to the total size", () => {
  const rows = [item(2, 250, 70), item(3, 320, 30), item(10, 2000, 400)];
  const slots = flowSlots(rows, 3000, 50);
  const sum = slots.reduce((acc, s) => acc + (s.kind === "gap" ? s.size : s.item.size), 0);
  expect(sum).toBe(3000);
});

let ui: Mounted | undefined;
afterEach(() => ui?.cleanup());

test("mounted rows render in flow, never absolutely positioned", () => {
  function List() {
    const v = useFlowVirtualizer({
      count: 500,
      getScrollElement: () => null,
      estimateSize: () => 40,
      initialRect: { width: 400, height: 400 },
      rangeExtractor: (range) => {
        // Reading window at the top plus a mounted tail, like the transcript.
        const out: number[] = [];
        for (let i = range.startIndex; i <= range.endIndex; i++) out.push(i);
        for (let i = 495; i < 500; i++) out.push(i);
        return out;
      },
    });
    const slots = flowSlots(v.getVirtualItems(), v.getTotalSize(), 0);
    return (
      <div ref={v.containerRef}>
        {slots.map((slot) =>
          slot.kind === "gap" ? (
            <div key={slot.key} {...{ [FLOW_GAP_ATTR]: slot.key }} style={{ height: `${slot.size}px` }} />
          ) : (
            <div key={slot.key} data-index={slot.item.index} className="row">
              row {slot.item.index}
            </div>
          ),
        )}
      </div>
    );
  }
  ui = mount();
  ui.render(<List />);
  const rows = ui.queryAll(".row") as HTMLElement[];
  expect(rows.length).toBeGreaterThan(5);
  for (const row of rows) {
    expect(row.style.position).toBe("");
    expect(row.style.transform).toBe("");
  }
  const gaps = ui.queryAll(`[${FLOW_GAP_ATTR}]`) as HTMLElement[];
  expect(gaps.length).toBe(1);
  // Every unmounted row between the window and the tail, at its estimate.
  const lastWindowRow = Number(rows[rows.length - 6]!.dataset.index);
  expect(gaps[0]!.style.height).toBe(`${(495 - lastWindowRow - 1) * 40}px`);
});
