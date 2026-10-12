// The game screen: loop + input + camera + HUD + pause. Swap in your own
// createGame/stepGame/GameView; keep the wiring.
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TouchControls } from "../components/controls";
import { Banner, Hud, HudStat } from "../components/hud";
import { PauseOverlay } from "../components/screens";
import { useViewSize } from "../components/world";
import { createCamera, followCamera } from "../game/camera";
import { createInput, endFrame, releaseAll } from "../game/input";
import { formatTime } from "../game/progress";
import { profileStore, useProfile } from "../game/profile-store";
import { theme } from "../game/theme";
import { useGameLoop } from "../game/use-game-loop";
import { useKeyboard } from "../game/use-keyboard";
import { GameView } from "../games/coin-dash/game-view";
import { createGame, finalScore, GAME_ID, SHIPS, stepGame, UNLOCKS, WORLD } from "../games/coin-dash/logic";

export default function Play() {
  const profile = useProfile();
  const players = profile.settings.players;
  const input = useMemo(() => createInput(), []);
  const [round, setRound] = useState(0);
  const [paused, setPaused] = useState(false);
  const game = useRef(createGame(players));
  const cams = useRef({ p1: createCamera(WORLD.w / 2, WORLD.h / 2, 1), p2: createCamera(WORLD.w / 2, WORLD.h / 2, 1) });
  const view = useViewSize();
  const finished = useRef(false);

  // New round: fresh game state, released keys.
  useEffect(() => {
    game.current = createGame(players, 7 + round);
    finished.current = false;
    releaseAll(input);
  }, [round, players, input]);

  const togglePause = useCallback(() => setPaused((p) => !p), []);
  useKeyboard(input, players, togglePause);

  const split = players === 2;
  const vpH = split ? (view.height - 4) / 2 : view.height;
  const zoom = Math.min(1.2, Math.max(0.7, view.width / 520));

  useGameLoop(
    (dt) => {
      const g = game.current;
      stepGame(g, input, dt);
      for (const p of g.players) {
        const cam = cams.current[p.id];
        cam.zoom = zoom;
        followCamera(cam, p, dt, { velocity: { x: p.vx, y: p.vy }, lookAhead: 0.25, world: WORLD, viewW: view.width, viewH: vpH });
      }
      if (g.phase === "over" && !finished.current) {
        finished.current = true;
        profileStore.finishRun(
          { gameId: GAME_ID, score: finalScore(g), won: true, stats: [{ label: "Time", value: formatTime(g.time) }, { label: "Players", value: String(players) }] },
          UNLOCKS,
        );
        router.replace("/results");
      }
      endFrame(input);
    },
    { paused },
  );

  const g = game.current;
  const color = SHIPS[profile.selected[GAME_ID] ?? "default"] ?? SHIPS.default;
  const colors = { p1: color, p2: theme.p2 };
  const lead = g.players[0];

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.column}>
        <View style={{ flex: 1 }} onLayout={view.onLayout}>
          {view.width > 0 ? (
            <>
              {g.players.map((p, i) => (
                <View key={p.id} style={{ marginTop: i ? 4 : 0 }}>
                  <GameView game={g} cam={cams.current[p.id]} width={view.width} height={vpH} shipColors={colors} time={g.time} />
                  <Hud>
                    <HudStat label={split ? p.id.toUpperCase() : "SCORE"} value={p.score} color={split ? theme[p.id] : undefined} />
                    <HudStat label="LIVES" value={"♥".repeat(Math.max(0, p.lives)) || "—"} color={theme.danger} />
                    {i === 0 ? <HudStat label="TIME" value={Math.ceil(g.timeLeft)} /> : null}
                  </Hud>
                </View>
              ))}
              <Banner text={g.time < 1 ? "GO!" : lead.lives <= 0 && !split ? "Out of lives" : null} />
            </>
          ) : null}
          <Pressable accessibilityLabel="Pause" onPress={togglePause} style={styles.pause}>
            <Text style={styles.pauseText}>II</Text>
          </Pressable>
          {paused ? (
            <PauseOverlay onResume={() => setPaused(false)} onRestart={() => { setRound((r) => r + 1); setPaused(false); }} onQuit={() => router.replace("/")} />
          ) : null}
        </View>
        {profile.settings.touchControls ? <TouchControls input={input} players={players} kind="stick" /> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  column: { flex: 1, width: "100%", maxWidth: 560, alignSelf: "center" },
  pause: { position: "absolute", right: 10, bottom: 8, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(18,23,43,0.8)", alignItems: "center", justifyContent: "center" },
  pauseText: { color: theme.ink, fontWeight: "900" },
});
