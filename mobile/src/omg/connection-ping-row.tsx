import { useEffect, useState } from "react";
import { AppState, View } from "react-native";
import type { OmgTransport } from "@omg-dev/client";
import { Row, Separator } from "../components";
import { Text } from "./text";
import { useTheme } from "./theme";
import { startConnectionPing, type ConnectionPing } from "./connection-ping";

export function ConnectionPingRow({ transport, active, cloud = false, demo = false }: {
  transport: Pick<OmgTransport, "openLiveSocket"> | null;
  active: boolean;
  cloud?: boolean;
  demo?: boolean;
}) {
  const { colors } = useTheme();
  const [state, setState] = useState<ConnectionPing | null>(null);
  useEffect(() => {
    setState(null);
    if (!active || !transport || demo) return;
    let stop: (() => void) | undefined;
    const update = () => {
      stop?.(); stop = undefined; setState(null);
      if (AppState.currentState === "active") stop = startConnectionPing(transport, setState, cloud);
    };
    update();
    const subscription = AppState.addEventListener("change", update);
    return () => { subscription.remove(); stop?.(); };
  }, [transport, active, cloud, demo]);
  const value = demo ? "Demo" : !transport ? "No computer selected" : state?.status === "connected"
    ? `${state.ms} ms` : state?.status === "unavailable" ? "Unavailable" : "Measuring…";
  return <>
    <Separator inset="icon" />
    <Row>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ fontSize: 17, color: colors.text }}>Connection ping</Text>
        <Text style={{ fontSize: 13, color: colors.textMuted }}>{state?.route ?? (cloud ? "Cloud computer" : "Phone to computer round trip")}</Text>
      </View>
      <Text testID="connection-ping-value" accessibilityLabel={`Connection ping: ${value}`} style={{ fontSize: 17, color: colors.textMuted, fontVariant: ["tabular-nums"] }}>{value}</Text>
    </Row>
  </>;
}
