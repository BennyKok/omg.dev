/**
 * The follow probe's verdict, drawn over the transcript for the simulator plan
 * and the recording. Absolutely positioned and untouchable, so it cannot move
 * the list it is judging. Only mounted in a probe build (see follow-probe.ts).
 */
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { followVerdict, type FollowProbe } from "./follow-probe";
import { readTotals, readVerdict, type ReadProbe } from "./read-probe";

export function FollowProbeView({ probe, reader, top }: { probe: FollowProbe; reader: ReadProbe | null; top: number }) {
  const [report, setReport] = useState(() => probe.report());
  const [reading, setReading] = useState(() => reader?.tracker.report() ?? null);
  useEffect(() => {
    const refresh = () => {
      setReport(probe.report());
      setReading(reader?.tracker.report() ?? null);
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
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`} style={{ color: "#fff", fontSize: 11 }}>
          {line}
        </Text>
      ))}
    </View>
  );
}
