import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { useSkipSameState } = await import("./use-skip-same-state");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

test("setting the value it already holds does not render again; a new value does", () => {
  let renders = 0;
  let set!: (action: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
  const initial = { a: 1 };
  function Probe() {
    const [value, setValue] = useSkipSameState(initial);
    set = setValue;
    renders += 1;
    return <span>{value.a}</span>;
  }
  ui.render(<Probe />);
  const settled = renders;
  ui.flush(() => set((prev) => prev));
  ui.flush(() => set(initial));
  expect(renders).toBe(settled);
  ui.flush(() => set((prev) => ({ a: prev.a + 1 })));
  ui.flush(() => set((prev) => ({ a: prev.a + 1 })));
  expect(ui.text()).toBe("3");
});
