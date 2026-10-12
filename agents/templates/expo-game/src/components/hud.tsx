// Heads-up display pieces. `Hud` is an absolute row at the top of its parent: put it inside the view that holds the
// game, after it. They show values; the game rules own the numbers.
import { StyleSheet, Text, View } from "react-native";
import { theme } from "../game/theme";

export function HudStat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

/** A bar from 0 to 1, for health, fuel, damage or a timer. */
export function HudBar({ label, value, color = theme.good }: { label: string; value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <View style={styles.barWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export function Hud({ children }: { children: React.ReactNode }) {
  return (
    <View pointerEvents="box-none" style={styles.hud}>
      {children}
    </View>
  );
}

/** Big centre text such as "3", "GO!" or "Lap 2". */
export function Banner({ text, color = theme.accent }: { text: string | null; color?: string }) {
  if (!text) return null;
  return (
    <View pointerEvents="none" style={styles.banner}>
      <Text style={[styles.bannerText, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hud: { position: "absolute", left: 0, right: 0, top: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 12, paddingTop: 8, gap: 10 },
  stat: { backgroundColor: "rgba(18,23,43,0.78)", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, alignItems: "center", minWidth: 64 },
  label: { color: theme.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  value: { color: theme.ink, fontSize: 22, fontWeight: "900" },
  barWrap: { flex: 1, gap: 4 },
  track: { height: 10, borderRadius: 5, backgroundColor: "rgba(255,255,255,0.18)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 5 },
  banner: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  bannerText: { fontSize: 56, fontWeight: "900", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 8 },
});
