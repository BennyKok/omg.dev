import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { createLatencySource, useLatencyMs } = await import("../useLiveSocket");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

test("a ping updates the readout without rendering its parent", () => {
  const latency = createLatencySource();
  let parentRenders = 0;
  function Readout() {
    const ms = useLatencyMs(latency);
    return <span>{ms == null ? "Measuring ping…" : `Ping ${ms} ms`}</span>;
  }
  function Parent() {
    parentRenders += 1;
    return <Readout />;
  }
  ui.render(<Parent />);
  expect(ui.text()).toBe("Measuring ping…");

  ui.flush(() => latency.set(42));
  expect(ui.text()).toBe("Ping 42 ms");
  ui.flush(() => latency.set(57));
  expect(ui.text()).toBe("Ping 57 ms");

  expect(parentRenders).toBe(1);
});

test("a missing source reads as no measurement", () => {
  function Readout() {
    return <span>{String(useLatencyMs(null))}</span>;
  }
  ui.render(<Readout />);
  expect(ui.text()).toBe("null");
});
