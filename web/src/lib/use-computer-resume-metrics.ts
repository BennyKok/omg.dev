import { useEffect, useRef } from "react";
import { createComputerResumeMetrics, type ResumeMetric, type ResumeObservation } from "./computer-resume-metrics";
import { useEmbeddedHostOptions } from "./embedded-host-options";
import { emitAnalyticsToHost } from "./embed-host-signal";
import { readLocationEmbedFlag } from "./embed";
import { evlog } from "./evlog";

/** App owns the connection. Bare secondary surfaces do not count it again. */
export function useComputerResumeMetrics(input: Omit<ResumeObservation, "foreground">, enabled: boolean) {
  const { onAnalyticsEvent } = useEmbeddedHostOptions();
  const tracker = useRef<ReturnType<typeof createComputerResumeMetrics> | null>(null);
  tracker.current ??= createComputerResumeMetrics();
  const latest = useRef({ input, onAnalyticsEvent });
  latest.current = { input, onAnalyticsEvent };
  const report = (events: ResumeMetric[]) => {
    for (const metric of events) {
      try {
        if (latest.current.onAnalyticsEvent) latest.current.onAnalyticsEvent("computer_resume", metric);
        else emitAnalyticsToHost("computer_resume", metric, readLocationEmbedFlag());
      } catch { /* Analytics must never block recovery. */ }
      evlog("computer_resume", metric);
    }
  };
  useEffect(() => {
    if (!enabled) return;
    report(tracker.current!.observe({ ...input, foreground: document.visibilityState !== "hidden" }));
  }, [enabled, input.generation, input.live, input.lifecycle]);
  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => report(tracker.current!.observe({
      ...latest.current.input, foreground: document.visibilityState !== "hidden",
    }));
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      report(tracker.current!.abandon());
    };
  }, [enabled]);
}
