// The game screen: loop + input + view + HUD + pause. It is the same for 2D
// and 3D: the view comes from src/app/view.ts. For your game, change the
// coin-dash imports, the HUD numbers, FEEDBACK, the buttons and the finish()
// line. The touch control kind is GAME.controls.kind in about.ts. Keep
// the rest of the wiring: run.step and run.finish send the tracking events,
// save the result and handle daily and challenge rounds.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { axisX, axisY, createInput, endFrame, releaseAll, type Input } from "../game/input";
import { useGameLoop, useLiveValue, usePageHidden } from "../game/use-game-loop";
import { useKeyboard } from "../game/use-keyboard";
import { createGame, finalScore, GAME_ID, MAX_LIVES, shareLine, SKINS, stepGame, UNLOCKS, type GameEvent } from "../games/coin-dash/logic";
import { GameCanvas, useCanvas, useGameView } from "../ui/canvas";
import { TouchControls } from "../ui/controls";
import { Banner, Hud, HudHearts, HudScore, HudTimer } from "../ui/hud";
import { IconDash } from "../ui/icons";
import { useProfile } from "../ui/profile-store";
import { router } from "../ui/router";
import { useRun } from "../ui/run";
import { PauseOverlay } from "../ui/screens";
import { sound, vibrate } from "../ui/sound";
import { theme } from "../ui/theme";
import { GAME } from "./about";
import { ART } from "./art";
import { loadView } from "./view";

/** Sound and vibration for each game event. */
const FEEDBACK: Record<GameEvent["type"], () => void> = {
  coin: () => sound.play("coin"),
  dash: () => sound.play("dash"),
  hurt: () => {
    sound.play("hurt");
    vibrate(60);
  },
};

const moved = (input: Input) =>
  axisX(input, "p1") !== 0 || axisY(input, "p1") !== 0 || axisX(input, "p2") !== 0 || axisY(input, "p2") !== 0 || input.p1.tapped.a || input.p2.tapped.a;

export default function Play() {
  const profile = useProfile();
  const run = useRun({ gameId: GAME_ID, unlocks: UNLOCKS, launchDay: GAME.launchDay });
  // Daily and challenge rounds are one player, so the scores compare.
  const players = run.spec.mode === "free" ? profile.settings.players : 1;
  const input = useMemo(() => createInput(), []);
  const [paused, setPaused] = useState(false);
  const game = useRef(createGame(players, run.spec.seed));
  const over = useRef(false);
  const canvas = useCanvas();
  const color = SKINS[profile.selected[GAME_ID] ?? "default"] ?? SKINS.default;
  const { view, ready, error } = useGameView(loadView, canvas, { colors: { p1: color, p2: theme.p2 } });

  // New round: fresh game state, released keys.
  useEffect(() => {
    game.current = createGame(players, run.spec.seed);
    over.current = false;
    releaseAll(input);
  }, [run.spec, players, input]);

  const togglePause = useCallback(() => setPaused((p) => !p), []);
  useKeyboard(input, players, togglePause);
  usePageHidden(() => setPaused(true)); // a phone call or app switch pauses the game

  useGameLoop(
    (dt) => {
      const g = game.current;
      run.step(dt, moved(input));
      stepGame(g, input, dt);
      for (const e of g.events.splice(0)) FEEDBACK[e.type]();
      view.current?.update?.(g, dt);
      if (g.phase === "over" && !over.current) {
        over.current = true;
        const score = finalScore(g);
        const lives = Math.max(...g.players.map((p) => p.lives));
        sound.play(lives > 0 ? "win" : "lose");
        run.finish({
          score,
          seconds: g.time,
          title: lives > 0 ? GAME.resultTitle : "Out of hearts!",
          stats: [{ label: "Coins", value: String(Math.max(...g.players.map((p) => p.score)) / 10) }],
          shareLine: shareLine(score, lives, run.spec.mode === "daily" ? `${GAME.name} daily #${run.spec.dayNumber}` : GAME.name),
        });
      }
      endFrame(input);
    },
    // The clock waits while the view loads (3D downloads three.js first).
    { paused: paused || !ready, draw: (alpha) => view.current?.draw(game.current, alpha) },
  );

  // HUD numbers. The screen redraws only when one of them changes.
  const hud = useLiveValue(() => {
    const g = game.current;
    return {
      time: Math.ceil(g.timeLeft),
      players: g.players.map((p) => ({ id: p.id, score: p.score, lives: p.lives })),
      banner: g.time < 1 ? "GO!" : null,
    };
  });
  const split = players === 2;

  return (
    <main className="play" data-ready={ready ? "" : undefined}>
      <div className="game-area">
        <GameCanvas canvas={canvas} label={GAME.name} />
        <div className={`views${split ? " split" : ""}`}>
          {hud.players.map((p, i) => (
            <div key={p.id} className="view">
              <Hud onPause={i === 0 ? togglePause : undefined} tint={split ? theme[p.id] : undefined}>
                <HudScore value={p.score} icon={ART.scoreIcon} label={split ? `Player ${i + 1} score` : "Score"} />
                <HudHearts lives={p.lives} max={MAX_LIVES} />
                {i === 0 ? <HudTimer seconds={hud.time} /> : null}
              </Hud>
            </div>
          ))}
        </div>
        <Banner text={error ? "This device cannot show the game" : !ready ? "Loading…" : hud.banner} />
        {/* The control kind comes from about.ts, so the menu hint and the control always match. */}
        <TouchControls input={input} players={players} kind={GAME.controls.kind} axes={GAME.controls.axes} buttons={[{ action: "a", label: "Dash", icon: <IconDash size={34} /> }]} />
        {paused ? (
          <PauseOverlay onResume={() => setPaused(false)} onRestart={() => { run.restart(); setPaused(false); }} onQuit={() => router.replace("/")} />
        ) : null}
      </div>
    </main>
  );
}
