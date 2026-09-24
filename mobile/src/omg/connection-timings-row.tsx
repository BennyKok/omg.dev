import { useState, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import { Row, Separator } from "../components";
import { Text } from "./text";
import { useTheme } from "./theme";
import { connectionTimings, subscribeConnectionTimings } from "./connection-trace";

function Timings() {
  const { colors } = useTheme();
  const timings = useSyncExternalStore(subscribeConnectionTimings, connectionTimings);
  const first = Math.min(...timings.map(t => t.atMs));
  return <View style={{ padding: 16, gap: 5 }}>
    <Text style={{ fontSize: 13, color: colors.textMuted }}>Recent timings on this device. Body time includes native delivery. Commit means React updated the screen, not confirmed display paint.</Text>
    {timings.filter(t => !t.stage.endsWith(".size")).slice(-16).map((t, i) => <Text key={`${t.atMs}-${i}`} style={{ fontSize: 12, color: colors.textMuted, fontVariant: ["tabular-nums"] }}>+{((t.atMs - first) / 1000).toFixed(1)}s {t.stage}: {t.durationMs} ms{t.failed ? " · failed" : ""}{t.size !== undefined ? ` · ${t.size} chars` : ""}</Text>)}
    {!timings.length && <Text style={{ color: colors.textMuted }}>No connection timings yet.</Text>}
  </View>;
}
export function ConnectionTimingsRow({ active }: { active: boolean }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  return <>
    <Separator inset="icon" />
    <Pressable accessibilityRole="button" accessibilityLabel="Connection timings" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}>
      <Row><Text style={{ color: colors.text, fontSize: 17, flex: 1 }}>Connection timings</Text><Text style={{ color: colors.textMuted }}>{expanded ? "Hide" : "Show"}</Text></Row>
    </Pressable>
    {expanded && active && <Timings />}
  </>;
}
