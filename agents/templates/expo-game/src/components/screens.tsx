// Standard game screens. Each takes plain props and has no game rules inside.
// MenuScreen, PauseOverlay, ResultsScreen, UnlocksScreen, SettingsPanel.
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { isUnlocked, type Profile, type Unlock } from "../game/progress";
import { theme } from "../game/theme";

export function GameButton({ label, onPress, kind = "primary", disabled }: { label: string; onPress: () => void; kind?: "primary" | "ghost"; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, kind === "ghost" && styles.ghost, pressed && { opacity: 0.8 }, disabled && { opacity: 0.4 }]}
    >
      <Text style={[styles.buttonText, kind === "ghost" && { color: theme.ink }]}>{label}</Text>
    </Pressable>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.column}>{children}</View>
    </SafeAreaView>
  );
}

export function MenuScreen({ title, subtitle, art, buttons, footer }: {
  title: string; subtitle?: string; art?: React.ReactNode; buttons: { label: string; onPress: () => void; kind?: "primary" | "ghost" }[]; footer?: string;
}) {
  return (
    <Screen>
      <View style={styles.center}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {art}
        <View style={styles.stack}>
          {buttons.map((b) => <GameButton key={b.label} {...b} />)}
        </View>
        {footer ? <Text style={styles.footer}>{footer}</Text> : null}
      </View>
    </Screen>
  );
}

/** Dim layer over the game. Render it while paused. */
export function PauseOverlay({ onResume, onRestart, onQuit }: { onResume: () => void; onRestart: () => void; onQuit: () => void }) {
  return (
    <View style={styles.overlay}>
      <Text style={styles.title}>Paused</Text>
      <View style={styles.stack}>
        <GameButton label="Resume" onPress={onResume} />
        <GameButton label="Restart" kind="ghost" onPress={onRestart} />
        <GameButton label="Quit to menu" kind="ghost" onPress={onQuit} />
      </View>
    </View>
  );
}

export function ResultsScreen({ profile, title, unlocks, onAgain, onMenu, onUnlocks }: {
  profile: Profile; title?: string; unlocks: readonly Unlock[]; onAgain: () => void; onMenu: () => void; onUnlocks?: () => void;
}) {
  const run = profile.lastRun;
  if (!run) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.title}>No result yet</Text>
          <GameButton label="Play" onPress={onAgain} />
        </View>
      </Screen>
    );
  }
  const fresh = run.newlyUnlocked.map((id) => unlocks.find((u) => u.id === id)).filter((u): u is Unlock => Boolean(u));
  return (
    <Screen>
      <View style={styles.center}>
        <Text style={styles.title}>{title ?? (run.won === false ? "Game over" : "Finished!")}</Text>
        <Text style={styles.score}>{run.score}</Text>
        <Text style={styles.subtitle}>{run.newBest ? "New best score!" : `Best: ${profile.bestScores[run.gameId] ?? run.score}`}</Text>
        {run.stats?.map((s) => (
          <View key={s.label} style={styles.statRow}>
            <Text style={styles.statLabel}>{s.label}</Text>
            <Text style={styles.statValue}>{s.value}</Text>
          </View>
        ))}
        {fresh.map((u) => (
          <View key={u.id} style={styles.unlockBanner}>
            <Text style={styles.unlockTitle}>Unlocked: {u.label}</Text>
            <Text style={styles.statLabel}>{u.description}</Text>
          </View>
        ))}
        <View style={styles.stack}>
          <GameButton label="Play again" onPress={onAgain} />
          {onUnlocks ? <GameButton label="Unlocks" kind="ghost" onPress={onUnlocks} /> : null}
          <GameButton label="Menu" kind="ghost" onPress={onMenu} />
        </View>
      </View>
    </Screen>
  );
}

export function UnlocksScreen({ profile, unlocks, selectedId, onSelect, onBack, renderPreview }: {
  profile: Profile; unlocks: readonly Unlock[]; selectedId?: string; onSelect?: (id: string) => void; onBack: () => void;
  renderPreview?: (u: Unlock, open: boolean) => React.ReactNode;
}) {
  return (
    <Screen>
      <Text style={[styles.title, { marginTop: 12 }]}>Unlocks</Text>
      <ScrollView contentContainerStyle={{ gap: 10, padding: 16 }}>
        {unlocks.map((u) => {
          const open = isUnlocked(profile, u.id, unlocks);
          return (
            <Pressable
              key={u.id}
              disabled={!open || !onSelect}
              onPress={() => onSelect?.(u.id)}
              style={[styles.card, selectedId === u.id && { borderColor: theme.accent }, !open && { opacity: 0.55 }]}
            >
              {renderPreview?.(u, open)}
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{open ? u.label : `${u.label} (locked)`}</Text>
                <Text style={styles.statLabel}>{open ? u.description : `Reach a score of ${u.scoreAtLeast} to unlock.`}</Text>
              </View>
              {selectedId === u.id ? <Text style={styles.cardTitle}>✓</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ padding: 16 }}>
        <GameButton label="Back" kind="ghost" onPress={onBack} />
      </View>
    </Screen>
  );
}

export function SettingsRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.cardTitle}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.accent, false: theme.surfaceBorder }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  column: { flex: 1, width: "100%", maxWidth: 560, alignSelf: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 20 },
  title: { color: theme.ink, fontSize: 38, fontWeight: "900", textAlign: "center", letterSpacing: 0.5 },
  subtitle: { color: theme.muted, fontSize: 16, textAlign: "center" },
  score: { color: theme.accent, fontSize: 72, fontWeight: "900" },
  footer: { color: theme.muted, fontSize: 12, textAlign: "center" },
  stack: { width: "100%", maxWidth: 320, gap: 10, marginTop: 8 },
  button: { backgroundColor: theme.accent, borderRadius: 16, paddingVertical: 14, alignItems: "center", borderWidth: 2, borderColor: theme.accent },
  ghost: { backgroundColor: "transparent", borderColor: theme.surfaceBorder },
  buttonText: { color: theme.accentInk, fontSize: 18, fontWeight: "900" },
  overlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(10,13,28,0.85)", alignItems: "center", justifyContent: "center", gap: 14, padding: 20 },
  statRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", width: "100%", maxWidth: 320 },
  statLabel: { color: theme.muted, fontSize: 14 },
  statValue: { color: theme.ink, fontSize: 16, fontWeight: "800" },
  unlockBanner: { backgroundColor: theme.surface, borderRadius: 14, padding: 12, borderWidth: 2, borderColor: theme.accent, width: "100%", maxWidth: 320 },
  unlockTitle: { color: theme.accent, fontSize: 16, fontWeight: "900" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.surface, borderRadius: 14, padding: 14, borderWidth: 2, borderColor: theme.surfaceBorder },
  cardTitle: { color: theme.ink, fontSize: 16, fontWeight: "800" },
});
