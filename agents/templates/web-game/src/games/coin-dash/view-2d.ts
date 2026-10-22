// Coin Dash, 2D view: draws the game on the canvas with the 2D context.
// The rules are in logic.ts and do not change between 2D and 3D.
// Each object draws its image from src/app/art.ts when there is one, and a
// placeholder shape in the theme colours when there is not. Keep createView's
// shape (src/game/view.ts).
import { ART } from "../../app/art";
import { createCamera, followCamera } from "../../game/camera";
import { clamp } from "../../game/collision";
import type { PlayerId } from "../../game/input";
import { splitViewports, type CanvasSize, type GameView, type ViewOptions } from "../../game/view";
import { drawShadow, drawWorld, loadImage, setup2d } from "../../render/canvas2d";
import { theme } from "../../ui/theme";
import { isDashing, WORLD, type Coin, type Game, type Hazard, type Player } from "./logic";

const sprite = (key: string) => {
  const src = ART.sprites[key];
  return src ? loadImage(src) : null;
};

function drawCoin(c: CanvasRenderingContext2D, coin: Coin, t: number): void {
  const bob = Math.sin(t * 3 + coin.id) * 2;
  drawShadow(c, coin.x, coin.y, coin.r * 0.9, 0.12);
  const img = sprite("coin");
  const spin = Math.max(0.3, Math.abs(Math.cos(t * 3 + coin.id * 0.7)));
  const r = coin.r * 1.15;
  c.save();
  c.translate(coin.x, coin.y - 4 + bob);
  if (img) {
    c.drawImage(img, -r * spin, -r, r * 2 * spin, r * 2);
  } else {
    c.scale(spin, 1);
    c.fillStyle = shade(theme.coin, -0.25);
    c.beginPath();
    c.arc(0, 2, r, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = theme.coin;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = shade(theme.coin, -0.18);
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(0, 0, r * 0.68, 0, Math.PI * 2);
    c.stroke();
    star(c, 0, 0, r * 0.45, "#ffffff");
  }
  c.restore();
}

function drawHazard(c: CanvasRenderingContext2D, h: Hazard, t: number, i: number): void {
  drawShadow(c, h.x, h.y, h.r, 0.16);
  const img = sprite("hazard");
  const squash = 1 + Math.sin(t * 6 + i) * 0.06;
  const w = h.r * 1.25 * squash;
  const hh = h.r * 1.1 / squash;
  c.save();
  c.translate(h.x, h.y);
  if (img) {
    c.drawImage(img, -w, -hh * 1.2, w * 2, hh * 2);
  } else {
    // A jelly blob: round top, flat bottom, a shine and cross eyes.
    c.fillStyle = theme.hazard;
    c.beginPath();
    c.moveTo(-w, hh * 0.55);
    c.bezierCurveTo(-w * 1.05, -hh * 1.25, w * 1.05, -hh * 1.25, w, hh * 0.55);
    c.quadraticCurveTo(0, hh * 0.85, -w, hh * 0.55);
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.35)";
    c.beginPath();
    c.ellipse(-w * 0.45, -hh * 0.45, w * 0.22, hh * 0.14, -0.6, 0, Math.PI * 2);
    c.fill();
    const dir = Math.sign(h.vx) || 1;
    c.fillStyle = "#2a1f45";
    for (const s of [-1, 1]) {
      c.beginPath();
      c.ellipse(s * w * 0.3 + dir * 2, -hh * 0.05, w * 0.1, hh * 0.16, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.strokeStyle = "#2a1f45";
    c.lineWidth = 2.2;
    c.lineCap = "round";
    for (const s of [-1, 1]) {
      c.beginPath();
      c.moveTo(s * w * 0.48 + dir * 2, -hh * 0.38);
      c.lineTo(s * w * 0.14 + dir * 2, -hh * 0.26);
      c.stroke();
    }
  }
  c.restore();
}

function drawPlayer(c: CanvasRenderingContext2D, game: Game, p: Player, color: string): void {
  const t = game.time;
  const blink = t < p.hurtUntil && Math.floor(t * 12) % 2 === 1;
  if (p.lives <= 0) return;
  drawShadow(c, p.x, p.y, p.r, 0.2);
  if (isDashing(game, p)) {
    // A short trail of puffs behind the runner.
    for (let k = 1; k <= 3; k++) {
      c.fillStyle = `rgba(255,255,255,${0.5 - k * 0.12})`;
      c.beginPath();
      c.arc(p.x - p.fx * k * 12, p.y - p.fy * k * 12, p.r * (0.8 - k * 0.15), 0, Math.PI * 2);
      c.fill();
    }
  }
  if (blink) return;
  const moving = Math.hypot(p.vx, p.vy) > 10;
  const hop = moving ? Math.abs(Math.sin(t * 14)) * 4 : 0;
  const img = sprite("player");
  c.save();
  c.translate(p.x, p.y - hop - 2);
  const r = p.r * 1.15;
  if (img) {
    c.scale(p.fx < 0 ? -1 : 1, 1);
    c.drawImage(img, -r * 1.2, -r * 1.3, r * 2.4, r * 2.4);
  } else {
    c.fillStyle = shade(color, -0.22);
    c.beginPath();
    c.arc(0, 2.5, r, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = color;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.4)";
    c.beginPath();
    c.ellipse(-r * 0.4, -r * 0.45, r * 0.25, r * 0.15, -0.6, 0, Math.PI * 2);
    c.fill();
    // The face looks where the runner goes.
    const fx = p.fx * r * 0.32;
    const fy = p.fy * r * 0.22;
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.ellipse(fx, fy - r * 0.1, r * 0.55, r * 0.45, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#2a2440"; // eyes stay dark on every theme
    for (const s of [-1, 1]) {
      c.beginPath();
      c.ellipse(fx + s * r * 0.2, fy - r * 0.1, r * 0.09, r * 0.17, 0, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
}

/** A five-point star. */
function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

/** Lighten (amount > 0) or darken (< 0) a #rrggbb colour. */
function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (v: number) => Math.round(clamp(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount, 0, 255));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function createView(canvas: HTMLCanvasElement, { colors }: ViewOptions): GameView<Game> {
  let ctx: CanvasRenderingContext2D | null = null;
  let size: CanvasSize = { width: 0, height: 0, dpr: 1 };
  const cams: Record<PlayerId, ReturnType<typeof createCamera>> = {
    p1: createCamera(WORLD.w / 2, WORLD.h / 2),
    p2: createCamera(WORLD.w / 2, WORLD.h / 2),
  };

  return {
    resize(next) {
      size = next;
      ctx = setup2d(canvas, size);
    },
    update(game, dt) {
      const views = splitViewports(size, game.players.length);
      game.players.forEach((p, i) => {
        const cam = cams[p.id];
        // Fill the view with the world: a phone sees almost the whole arena, a wide screen scrolls.
        cam.zoom = clamp(Math.max(views[i].w / WORLD.w, views[i].h / WORLD.h), 0.6, 1.25);
        followCamera(cam, p, dt, { velocity: { x: p.vx, y: p.vy }, lookAhead: 0.25, world: WORLD, viewW: views[i].w, viewH: views[i].h });
      });
    },
    draw(game) {
      if (!ctx) return;
      const c = ctx;
      c.fillStyle = theme.background;
      c.fillRect(0, 0, size.width, size.height);
      splitViewports(size, game.players.length).forEach((view, i) => {
        drawWorld(c, cams[game.players[i].id], view, {
          background: theme.background, floor: theme.world, detail: theme.worldDetail, tile: 50,
          edge: theme.worldEdge, edgeWidth: 18, radius: 30, worldSize: WORLD,
        }, (c) => {
          for (const coin of game.coins) drawCoin(c, coin, game.time);
          game.hazards.forEach((h, k) => drawHazard(c, h, game.time, k));
          for (const p of game.players) drawPlayer(c, game, p, colors[p.id]);
        });
      });
    },
    dispose() {
      ctx = null;
    },
  };
}
