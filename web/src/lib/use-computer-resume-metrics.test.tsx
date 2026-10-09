import { afterEach, expect, spyOn, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { ResumeObservation } from "./computer-resume-metrics";
const { EmbeddedHostOptionsProvider } = await import("./embedded-host-options");
const { useComputerResumeMetrics } = await import("./use-computer-resume-metrics");
let ui: Mounted;
let clock: ReturnType<typeof spyOn>;
afterEach(() => { ui?.cleanup(); clock?.mockRestore(); });
function Probe({ input, enabled = true }: { input: Omit<ResumeObservation, "foreground">; enabled?: boolean }) {
  useComputerResumeMetrics(input, enabled);
  return null;
}

test("the connection owner sends measured completion through the hosted analytics callback once", () => {
  let now = 0;
  clock = spyOn(performance, "now").mockImplementation(() => now);
  const events: unknown[] = [];
  ui = mount();
  const render = (input: Omit<ResumeObservation, "foreground">) => ui.render(
    <EmbeddedHostOptionsProvider value={{ onAnalyticsEvent: (name, data) => events.push({ name, data }) }}>
      <Probe input={input} />
    </EmbeddedHostOptionsProvider>,
  );
  render({ generation: 1, live: false, lifecycle: "paused" });
  now = 20_000;
  render({ generation: 1, live: false, lifecycle: "ready" });
  expect(events).toHaveLength(0);
  now = 25_000;
  render({ generation: 1, live: true, lifecycle: null });
  render({ generation: 1, live: true, lifecycle: null });
  expect(events).toEqual([{ name: "computer_resume", data: {
    duration_ms: 25_000, result: "connected", initial_lifecycle: "paused", schema_version: 1,
  } }]);
});

test("secondary surfaces do not count the shared connection again", () => {
  const events: unknown[] = [];
  ui = mount();
  for (const live of [false, true]) {
    ui.render(<EmbeddedHostOptionsProvider value={{ onAnalyticsEvent: (...args) => events.push(args) }}>
      <Probe enabled={false} input={{ generation: 1, live, lifecycle: "waking" }} />
    </EmbeddedHostOptionsProvider>);
  }
  expect(events).toHaveLength(0);
});
