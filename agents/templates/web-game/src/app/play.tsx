// The game screen: loop + input + camera + canvas + HUD + pause. Swap in your
// own createGame/stepGame/drawGame; keep the wiring.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TouchControls, useTouchScreen } from "../components/controls";
import { Banner, Hud, HudStat } from "../components/hud";
import { PauseOverlay } from "../components/screens";
import { GameCanvas, useCanvas } from "../components/world";
import { createCamera, followCamera } from "../game/camera";
import { clamp } from "../game/collision";
import { createInput, endFrame, releaseAll } from "../game/input";
import { formatTime } from "../game/progress";
import { profileStore, useProfile } from "../game/profile-store";
import { router } from "../game/router";
import { theme } from "../game/theme";
import { useGameLoop, useLiveValue, usePageHidden } from "../game/use-game-loop";
import { useKeyboard } from "../game/use-keyboard";
import { drawGame } from "../games/coin-dash/draw";
import { createGame, finalScore, GAME_ID, SHIPS, stepGame, UNLOCKS, WORLD } from "../games/coin-dash/logic";

const GAP = 4; // px between the two split-screen views

export default function Play() {
  const profile = useProfile();
  const players = profile.settings.players;
  const input = useMemo(() => createInput(), []);
  const [round, setRound] = useState(0);
  const [paused, setPaused] = useState(false);
  const game = useRef(createGame(players));
  const cams = useRef({ p1: createCamera(WORLD.w / 2, WORLD.h / 2, 1), p2: createCamera(WORLD.w / 2, WORLD.h / 2, 1) });
  const canvas = useCanvas();
  const finished = useRef(false);
  const touch = useTouchScreen();

  // New round: fresh game state, released keys.
  useEffect(() => {
    game.current = createGame(players, 7 + round);
    finished.current = false;
    releaseAll(input);
  }, [round, players, input]);

  const togglePause = useCallback(() => setPaused((p) => !p), []);
  useKeyboard(input, players, togglePause);
  usePageHidden(() => setPaused(true)); // a phone call or app switch pauses the game

  const split = players === 2;
  const color = SHIPS[profile.selected[GAME_ID] ?? "default"] ?? SHIPS.default;
  const colors = { p1: color, p2: theme.p2 };

  /** Each player's part of the canvas, in CSS pixels. */
  const views = () => {
    const { width, height } = canvas.size.current;
    const h = split ? (height - GAP) / 2 : height;
    return game.current.players.map((_, i) => ({ x: 0, y: i * (h + GAP), w: width, h }));
  };

  useGameLoop(
    (dt) => {
      const g = game.current;
      stepGame(g, input, dt);
      const vs = views();
      g.players.forEach((p, i) => {
        const cam = cams.current[p.id];
        // Fill the view's longer side with the world, so a tall phone scrolls sideways.
        cam.zoom = clamp(Math.max(vs[i].w / WORLD.w, vs[i].h / WORLD.h), 0.7, 1.2);
        followCamera(cam, p, dt, { velocity: { x: p.vx, y: p.vy }, lookAhead: 0.25, world: WORLD, viewW: vs[i].w, viewH: vs[i].h });
      });
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
    {
      paused,
      draw: () => {
        const ctx = canvas.context();
        if (!ctx) return;
        const g = game.current;
        const { width, height } = canvas.size.current;
        ctx.fillStyle = theme.background;
        ctx.fillRect(0, 0, width, height);
        views().forEach((view, i) => drawGame(ctx, { game: g, cam: cams.current[g.players[i].id], view, shipColors: colors, time: g.time }));
      },
    },
  );

  // HUD numbers. The screen redraws only when one of them changes.
  const hud = useLiveValue(() => {
    const g = game.current;
    return {
      time: Math.ceil(g.timeLeft),
      players: g.players.map((p) => ({ id: p.id, score: p.score, lives: p.lives })),
      banner: g.time < 1 ? "GO!" : g.players[0].lives <= 0 && !split ? "Out of lives" : null,
    };
  });

  return (
    <main className="play">
      <div className="game-area">
        <GameCanvas canvas={canvas} label="Coin Dash" />
        <div className="views">
          {hud.players.map((p, i) => (
            <div key={p.id} className="view">
              <Hud>
                <HudStat label={split ? p.id.toUpperCase() : "SCORE"} value={p.score} color={split ? theme[p.id] : undefined} />
                <HudStat label="LIVES" value={"♥".repeat(Math.max(0, p.lives)) || "—"} color={theme.danger} />
                {i === 0 ? <HudStat label="TIME" value={hud.time} /> : null}
              </Hud>
            </div>
          ))}
        </div>
        <Banner text={hud.banner} />
        <button type="button" aria-label="Pause" className="pause-button" onClick={togglePause}>
          II
        </button>
        {paused ? (
          <PauseOverlay onResume={() => setPaused(false)} onRestart={() => { setRound((r) => r + 1); setPaused(false); }} onQuit={() => router.replace("/")} />
        ) : null}
      </div>
      {touch && profile.settings.touchControls ? <TouchControls input={input} players={players} kind="stick" /> : null}
    </main>
  );
}
