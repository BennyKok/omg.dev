// Draws a Coin Dash game into one player's view of the canvas. Replace with your art.
import type { Camera } from "../../game/camera";
import { drawSprite, drawWorld, type Viewport } from "../../game/draw";
import type { PlayerId } from "../../game/input";
import { theme } from "../../game/theme";
import { WORLD, type Game } from "./logic";

export function drawGame(ctx: CanvasRenderingContext2D, { game, cam, view, shipColors, time }: {
  game: Game; cam: Camera; view: Viewport; shipColors: Record<PlayerId, string>; time: number;
}): void {
  drawWorld(ctx, cam, view, { background: "#1c2a4a", worldSize: { w: WORLD.w, h: WORLD.h } }, (ctx) => {
    for (const c of game.coins) drawSprite(ctx, { x: c.x, y: c.y, size: c.r * 2, shape: "circle", color: theme.accent, borderColor: "#fff3b0" });
    for (const h of game.hazards) drawSprite(ctx, { x: h.x, y: h.y, size: h.r * 2, shape: "circle", color: "#7a3cff", borderColor: "#c7a8ff" });
    for (const p of game.players) {
      const blink = game.time < p.hurtUntil && Math.floor(time * 12) % 2;
      drawSprite(ctx, {
        x: p.x,
        y: p.y,
        size: p.r * 2,
        shape: "circle",
        color: shipColors[p.id],
        borderColor: "#ffffff",
        opacity: blink ? 0.35 : p.lives > 0 ? 1 : 0.2,
      });
    }
  });
}
