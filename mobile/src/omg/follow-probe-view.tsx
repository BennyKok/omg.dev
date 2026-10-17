/**
 * The follow probe's verdict, drawn over the transcript for the simulator plan
 * and the recording. Absolutely positioned and untouchable, so it cannot move
 * the list it is judging. Only mounted in a probe build (see follow-probe.ts).
 */
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useFrameCallback, useSharedValue } from "react-native-reanimated";
import { emptySnapshot, FRAME_BIN_MS, FRAME_BINS, perfLines, perfProbe, type FrameSnapshot } from "./perf-probe";
import { followVerdict, type FollowProbe } from "./follow-probe";
import { readTotals, readVerdict, type ReadProbe } from "./read-probe";

export function FollowProbeView({ probe, reader, top }: { probe: FollowProbe; reader: ReadProbe | null; top: number }) {
  const [report, setReport] = useState(() => probe.report());
  const [reading, setReading] = useState(() => reader?.tracker.report() ?? null);
  const [perf, setPerf] = useState<string[]>([]);
  // UI-thread frame intervals, only while the list is moving (see perf-probe.ts).
  const uiActive = useSharedValue(false);
  const uiFrames = useSharedValue<FrameSnapshot>(emptySnapshot());
  useFrameCallback(({ timeSincePreviousFrame: dt }) => {
    "worklet";
    if (!uiActive.value || dt == null) return;
    const s = uiFrames.value;
    const bins = s.bins.slice();
    bins[Math.min(FRAME_BINS - 1, Math.floor(dt / FRAME_BIN_MS))] += 1;
    uiFrames.value = {
      bins,
      count: s.count + 1,
      max: Math.max(s.max, dt),
      over25: s.over25 + (dt > 25 ? 1 : 0),
      over50: s.over50 + (dt > 50 ? 1 : 0),
    };
  });
  useEffect(() => {
    if (!perfProbe) return;
    perfProbe.onActive((active) => {
      uiActive.value = active;
    });
    perfProbe.resetListener = () => {
      uiFrames.value = emptySnapshot();
    };
    return () => {
      perfProbe?.onActive(null);
      if (perfProbe) perfProbe.resetListener = null;
    };
  }, [uiActive, uiFrames]);
  useEffect(() => {
    const refresh = () => {
      setReport(probe.report());
      setReading(reader?.tracker.report() ?? null);
      if (perfProbe) {
        perfProbe.ui.load(uiFrames.value);
        setPerf(perfLines(perfProbe, reader?.mounted() ?? 0));
      }
    };
    const off = probe.subscribe(refresh);
    const offReader = reader?.subscribe(refresh);
    // The watch counts up and freezes on time, not on an event.
    const timer = setInterval(refresh, 500);
    return () => {
      off();
      offReader?.();
      clearInterval(timer);
    };
  }, [probe, reader]);
  const verdict = followVerdict(report);
  const readLine = reading ? readVerdict(reading) : null;
  const totalsLine = reading ? readTotals(reading) : null;
  const lines = [...report.log, ...(reading?.log ?? [])];
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top,
        left: 12,
        right: 12,
        padding: 8,
        borderRadius: 8,
        backgroundColor: "rgba(0,0,0,0.78)",
      }}
    >
      <Text accessibilityLabel={verdict} style={{ color: "#ffd84d", fontSize: 13, fontWeight: "600" }}>
        {verdict}
      </Text>
      {readLine ? (
        <Text accessibilityLabel={readLine} style={{ color: "#7fd8ff", fontSize: 13, fontWeight: "600" }}>
          {readLine}
        </Text>
      ) : null}
      {totalsLine ? (
        <Text accessibilityLabel={totalsLine} style={{ color: "#7fd8ff", fontSize: 11 }}>
          {totalsLine}
        </Text>
      ) : null}
      {perf.map((line) => (
        <Text key={`perf-${line.split(":")[0]}`} accessibilityLabel={line} style={{ color: "#b8f5a0", fontSize: 10 }}>
          {line}
        </Text>
      ))}
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`} style={{ color: "#fff", fontSize: 11 }}>
          {line}
        </Text>
      ))}
    </View>
  );
}
