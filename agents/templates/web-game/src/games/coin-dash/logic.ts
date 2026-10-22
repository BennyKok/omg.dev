// Coin Dash: the sample game. Rules only: no React, no drawing. Collect coins,
// dodge bouncing hazards, beat the clock. Replace this folder with your game,
// keeping the same shape: createGame(), stepGame(), and a result.
import { circlesOverlap, keepCircleInside, seeded, type Circle } from "../../game/collision";
import { axisX, axisY, type Input, type PlayerId } from "../../game/input";
import type { Rect } from "../../game/collision";
import type { Unlock } from "../../game/progress";

export const WORLD: Rect = { x: 0, y: 0, w: 900, h: 600 };
export const GAME_ID = "coin-dash";
export const ROUND_SECONDS = 40;
export const PLAYER_SPEED = 260;

export type Player = Circle & { id: PlayerId; vx: number; vy: number; score: number; lives: number; hurtUntil: number };
export type Hazard = Circle & { vx: number; vy: number };
export type Coin = Circle & { id: number };

export type Game = {
  time: number;
  timeLeft: number;
  phase: "playing" | "over";
  players: Player[];
  coins: Coin[];
  hazards: Hazard[];
  rng: () => number;
  nextCoinId: number;
};

export function createGame(playerCount: 1 | 2, seed = 7): Game {
  const rng = seeded(seed);
  const ids: PlayerId[] = playerCount === 2 ? ["p1", "p2"] : ["p1"];
  const players = ids.map((id, i): Player => ({
    id, x: WORLD.w * (0.35 + i * 0.3), y: WORLD.h / 2, r: 16, vx: 0, vy: 0, score: 0, lives: 3, hurtUntil: 0,
  }));
  const game: Game = { time: 0, timeLeft: ROUND_SECONDS, phase: "playing", players, coins: [], hazards: [], rng, nextCoinId: 1 };
  for (let i = 0; i < 6; i++) spawnCoin(game);
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2;
    game.hazards.push({ x: 80 + rng() * (WORLD.w - 160), y: 60 + rng() * 120, r: 18, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120 });
  }
  return game;
}

export function spawnCoin(game: Game): void {
  game.coins.push({ id: game.nextCoinId++, x: 40 + game.rng() * (WORLD.w - 80), y: 40 + game.rng() * (WORLD.h - 80), r: 11 });
}

/** One fixed step. `dt` is the loop step in seconds. */
export function stepGame(game: Game, input: Input, dt: number): void {
  if (game.phase !== "playing") return;
  game.time += dt;
  game.timeLeft = Math.max(0, ROUND_SECONDS - game.time);

  for (const p of game.players) {
    const ax = axisX(input, p.id);
    const ay = axisY(input, p.id);
    const len = Math.hypot(ax, ay);
    const k = len > 1 ? 1 / len : 1;
    p.vx = ax * k * PLAYER_SPEED;
    p.vy = ay * k * PLAYER_SPEED;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    keepCircleInside(p, WORLD);
  }

  for (const h of game.hazards) {
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    const hit = keepCircleInside(h, WORLD);
    if (hit.x) h.vx = -h.vx;
    if (hit.y) h.vy = -h.vy;
  }

  for (const p of game.players) {
    for (let i = game.coins.length - 1; i >= 0; i--) {
      if (circlesOverlap(p, game.coins[i])) {
        game.coins.splice(i, 1);
        p.score += 10;
        spawnCoin(game);
      }
    }
    if (game.time >= p.hurtUntil && p.lives > 0) {
      if (game.hazards.some((h) => circlesOverlap(p, h))) {
        p.lives -= 1;
        p.hurtUntil = game.time + 1.2; // brief invulnerability
      }
    }
  }

  if (game.timeLeft <= 0 || game.players.every((p) => p.lives <= 0)) game.phase = "over";
}

/** Score for the profile: the best player's score plus a bonus for lives left. */
export function finalScore(game: Game): number {
  return Math.max(...game.players.map((p) => p.score + p.lives * 5));
}

export const UNLOCKS: Unlock[] = [
  { id: "default", label: "Red ship", description: "Where everyone starts.", scoreAtLeast: 0 },
  { id: "gold", label: "Gold ship", description: "A shiny gold ship.", scoreAtLeast: 100, gameId: GAME_ID },
  { id: "mint", label: "Mint ship", description: "A cool mint ship.", scoreAtLeast: 200, gameId: GAME_ID },
];

export const SHIPS: Record<string, string> = { default: "#ff5a6a", gold: "#ffcf33", mint: "#4ee08a" };
