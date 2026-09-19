// Standalone native benchmark. Never imported by the product entry point.
//
// Question it answers: what does the working-state activity grid cost, and how
// does that cost grow with the number of WORKING rows on screen?
//
// It renders the product SessionActivityField and SessionActivityTitle at the
// product's own row geometry, and measures the Reanimated UI-thread frame
// interval, which is where the grid's worklets run. A JS requestAnimationFrame
// series is recorded beside it to show the JS thread is not the constraint.
import { registerRootComponent } from "expo";
import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";
import {
  SessionActivityField,
  SessionActivityPane,
  SessionActivityTitle,
  useSessionActivity,
} from "../src/omg/session-activity";

const REPORT = "http://localhost:8095/result";
/** The product row: SESSION_ROW.height 80, inset 16 (src/components.tsx). */
const ROW_HEIGHT = 80;
const ROW_INSET = 16;
const WARMUP = 3000;
const DURATION = 8000;

/**
 * Row counts are interleaved, and each count appears twice, so thermal drift
 * or another agent's simulator landing mid-run shows up as disagreement
 * between the two samples instead of as a trend.
 */
const TRIALS: { rows: number; paused?: boolean }[] = [
  { rows: 0 },
  { rows: 24 },
  { rows: 4 },
  { rows: 24, paused: true },
  { rows: 12 },
  { rows: 0 },
  { rows: 24 },
  { rows: 4 },
  { rows: 24, paused: true },
  { rows: 12 },
];

const quantile = (a: number[], p: number) =>
  [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One working row, drawn the way the session list draws it. */
function Row({ index }: { index: number }) {
  const activity = useSessionActivity(true);
  const [textBounds, setTextBounds] = useState<{ x: number; y: number; width: number; height: number }>();
  return (
    <View style={{ height: ROW_HEIGHT, marginHorizontal: ROW_INSET, justifyContent: "center" }}>
      <SessionActivityField
        identity={`bench-session-${index}`}
        activity={activity}
        textBounds={textBounds as never}
        cornerRadius={12}
        horizontalOutset={ROW_INSET}
      />
      <View
        onLayout={({ nativeEvent: { layout } }) => setTextBounds(layout)}
        style={{ paddingLeft: 56 }}
      >
        <SessionActivityTitle
          title={`Benchmark session number ${index} is working`}
          activity={activity}
          style={{ fontSize: 17 }}
        />
      </View>
    </View>
  );
}

function Trial({ trial, spec, done }: { trial: number; spec: { rows: number; paused?: boolean }; done: () => void }) {
  const [status, setStatus] = useState("Warmup");
  const measuring = useSharedValue(false);
  const frames = useSharedValue({ count: 0, total: 0, over20: 0, over33: 0, max: 0 });
  useFrameCallback(({ timeSincePreviousFrame: dt }) => {
    if (!measuring.value || dt == null) return;
    const f = frames.value;
    frames.value = {
      count: f.count + 1,
      total: f.total + dt,
      over20: f.over20 + (dt > 20 ? 1 : 0),
      over33: f.over33 + (dt > 33 ? 1 : 0),
      max: Math.max(f.max, dt),
    };
  });
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    const js: number[] = [];
    void (async () => {
      await sleep(WARMUP);
      if (cancelled) return;
      setStatus("Measuring");
      measuring.value = true;
      let previous = performance.now();
      const begin = previous;
      const frame = () => {
        const now = performance.now();
        js.push(now - previous);
        previous = now;
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      await sleep(DURATION);
      cancelAnimationFrame(raf);
      measuring.value = false;
      if (cancelled) return;
      const ui = frames.value;
      const result = {
        trial,
        rows: spec.rows,
        paused: !!spec.paused,
        platform: Platform.OS,
        dev: __DEV__,
        durationMs: performance.now() - begin,
        ui: {
          count: ui.count,
          meanMs: ui.count ? ui.total / ui.count : 0,
          fps: ui.total ? (ui.count / ui.total) * 1000 : 0,
          over20: ui.over20,
          over33: ui.over33,
          maxMs: ui.max,
          coverage: (performance.now() - begin) ? ui.total / (performance.now() - begin) : 0,
        },
        js: {
          count: js.length,
          p50: quantile(js, 0.5),
          p95: quantile(js, 0.95),
          max: js.length ? Math.max(...js) : 0,
        },
      };
      setStatus("Recorded");
      try {
        await fetch(REPORT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
      } catch (error) {
        console.error("BENCH_REPORT_FAILED", error);
      }
      console.log("ACTIVITY_PERF", JSON.stringify(result));
      if (!cancelled) done();
    })();
    return () => {
      cancelled = true;
      measuring.value = false;
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: "#fff", paddingTop: 60 }}>
      <Text style={{ padding: 12, color: "#111" }}>
        Trial {trial + 1}/{TRIALS.length} · {spec.rows} rows{spec.paused ? " · pane covered" : ""} · {status}
      </Text>
      {/* `onScreen={false}` is the state Home is in while a session screen
          covers it. It is the thing the fix changed, measured directly. */}
      <SessionActivityPane onScreen={!spec.paused}>
        {Array.from({ length: spec.rows }, (_, i) => <Row key={i} index={i} />)}
      </SessionActivityPane>
    </View>
  );
}

function App() {
  const [trial, setTrial] = useState(0);
  if (trial >= TRIALS.length) {
    return (
      <View style={{ flex: 1, backgroundColor: "#fff", paddingTop: 80 }}>
        <Text style={{ padding: 12, color: "#111" }}>Benchmark complete.</Text>
      </View>
    );
  }
  return <Trial key={trial} trial={trial} spec={TRIALS[trial]} done={() => setTrial((t) => t + 1)} />;
}

registerRootComponent(App);
