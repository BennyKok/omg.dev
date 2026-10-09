import type { RuntimeLifecycle } from "./runtime-lifecycle";

export type ResumeMetric = {
  duration_ms: number;
  result: "connected" | "failed" | "abandoned";
  initial_lifecycle: "paused" | "waking";
  schema_version: 1;
};
export type ResumeObservation = {
  generation: number;
  live: boolean;
  foreground: boolean;
  lifecycle?: RuntimeLifecycle | null;
};

/** Measure the foreground wait, not the progress estimate or time away. */
export function createComputerResumeMetrics(now: () => number = () => performance.now()) {
  let attempt: { generation: number; startedAt: number; wake: ResumeMetric["initial_lifecycle"] | null } | null = null;
  const finish = (result: ResumeMetric["result"]): ResumeMetric[] => {
    const previous = attempt;
    attempt = null;
    return previous?.wake ? [{
      duration_ms: Math.max(0, Math.round(now() - previous.startedAt)),
      result,
      initial_lifecycle: previous.wake,
      schema_version: 1,
    }] : [];
  };
  return {
    observe(input: ResumeObservation): ResumeMetric[] {
      const events: ResumeMetric[] = [];
      if (attempt && (attempt.generation !== input.generation || !input.foreground)) {
        events.push(...finish("abandoned"));
      }
      if (!input.foreground) return events;
      if (input.live) return [...events, ...finish("connected")];
      attempt ??= { generation: input.generation, startedAt: now(), wake: null };
      if (input.lifecycle === "paused" || input.lifecycle === "waking") attempt.wake ??= input.lifecycle;
      if (input.lifecycle === "failed" || input.lifecycle === "unavailable") events.push(...finish("failed"));
      return events;
    },
    abandon: () => finish("abandoned"),
  };
}
