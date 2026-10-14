// Draws a Coin Dash game for one player's viewport. Replace with your art.
import { Sprite, World } from "../../components/world";
import type { Camera } from "../../game/camera";
import { theme } from "../../game/theme";
import type { PlayerId } from "../../game/input";
import { WORLD, type Game } from "./logic";

export function GameView({ game, cam, width, height, shipColors, time }: {
  game: Game; cam: Camera; width: number; height: number; shipColors: Record<PlayerId, string>; time: number;
}) {
  return (
    <World cam={cam} width={width} height={height} background="#1c2a4a" worldSize={{ w: WORLD.w, h: WORLD.h }}>
      {game.coins.map((c) => (
        <Sprite key={c.id} of={c} size={c.r * 2} shape="circle" color={theme.accent} borderColor="#fff3b0" />
      ))}
      {game.hazards.map((h, i) => (
        <Sprite key={i} of={h} size={h.r * 2} shape="circle" color="#7a3cff" borderColor="#c7a8ff" />
      ))}
      {game.players.map((p) => (
        <Sprite
          key={p.id}
          of={p}
          size={p.r * 2}
          shape="circle"
          color={shipColors[p.id]}
          borderColor="#ffffff"
          opacity={game.time < p.hurtUntil && Math.floor(time * 12) % 2 ? 0.35 : p.lives > 0 ? 1 : 0.2}
        />
      ))}
    </World>
  );
}
