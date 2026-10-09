import { expect, test } from "bun:test";
import { createComputerResumeMetrics, type ResumeObservation } from "./computer-resume-metrics";
const base: ResumeObservation = { generation: 1, live: false, foreground: true };

test("measures the whole wait through paused, waking and ready, once", () => {
  let now = 100;
  const tracker = createComputerResumeMetrics(() => now);
  tracker.observe(base);
  now = 2_100;
  tracker.observe({ ...base, lifecycle: "paused" });
  now = 20_100;
  tracker.observe({ ...base, lifecycle: "waking" });
  now = 25_100;
  expect(tracker.observe({ ...base, lifecycle: "ready" })).toEqual([]);
  now = 27_600;
  expect(tracker.observe({ ...base, live: true })).toEqual([
    { duration_ms: 27_500, result: "connected", initial_lifecycle: "paused", schema_version: 1 },
  ]);
  expect(tracker.observe({ ...base, live: true })).toEqual([]);
});

test("ordinary reconnects and cold starts do not count as resumes", () => {
  const tracker = createComputerResumeMetrics();
  tracker.observe({ ...base, lifecycle: "starting" });
  expect(tracker.observe({ ...base, live: true })).toEqual([]);
  tracker.observe(base);
  expect(tracker.observe({ ...base, live: true })).toEqual([]);
});

test("failures remain separate from successful latency", () => {
  let now = 0;
  const tracker = createComputerResumeMetrics(() => now);
  tracker.observe({ ...base, lifecycle: "waking" });
  now = 30_000;
  expect(tracker.observe({ ...base, lifecycle: "failed" })[0]).toMatchObject({ result: "failed", duration_ms: 30_000 });
  expect(tracker.observe({ ...base, live: true })).toEqual([]);
});

test("time away and computer switches cannot inflate successful latency", () => {
  let now = 0;
  const tracker = createComputerResumeMetrics(() => now);
  tracker.observe({ ...base, lifecycle: "paused" });
  now = 1_000;
  expect(tracker.observe({ ...base, foreground: false })[0]?.result).toBe("abandoned");
  now = 100_000;
  tracker.observe({ ...base, lifecycle: "waking" });
  now = 102_000;
  expect(tracker.observe({ ...base, live: true })[0]?.duration_ms).toBe(2_000);
  tracker.observe({ ...base, lifecycle: "waking" });
  expect(tracker.observe({ ...base, generation: 2 })[0]?.result).toBe("abandoned");
  expect(tracker.observe({ ...base, generation: 2, live: true })).toEqual([]);
});
