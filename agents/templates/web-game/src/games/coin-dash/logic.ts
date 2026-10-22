// Coin Dash: the sample game. Rules only: no React, no drawing. Collect coins,
// dodge bouncing hazards, dash, beat the clock. Replace this folder with your
// game, keeping the same shape: createGame(players, seed), stepGame(), events,
// and a final score. The same seed always gives the same level (daily
// challenge and challenge links depend on it).
import { emojiBar } from "../../game/challenge";
import { circlesOverlap, keepCircleInside, seeded, type Circle } from "../../game/collision";
import { axisX, axisY, wasTapped, type Input, type PlayerId } from "../../game/input";
import type { Rect } from "../../game/collision";
import type { Unlock } from "../../game/progress";

/** A portrait arena, for phones held upright. */
export const WORLD: Rect = { x: 0, y: 0, w: 600, h: 900 };
export const GAME_ID = "coin-dash";
export const ROUND_SECONDS = 40;
export const PLAYER_SPEED = 260;
export const MAX_LIVES = 3;
export const DASH_SPEED = 2.4; // times the normal speed
export const DASH_SECONDS = 0.22;
export const DASH_COOLDOWN = 0.9;

export type Player = Circle & {
  id: PlayerId; vx: number; vy: number; score: number; lives: number; hurtUntil: number;
  /** Last direction moved, so a dash from standing still goes somewhere. */
  fx: number; fy: number;
  dashUntil: number; dashReady: number;
};
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
  /** What happened this step, for sounds and vibration. play.tsx empties it. */
  events: GameEvent[];
};

export type GameEvent = { type: "coin" | "hurt" | "dash"; player: PlayerId };

export function createGame(playerCount: 1 | 2, seed = 7): Game {
  const rng = seeded(seed);
  const ids: PlayerId[] = playerCount === 2 ? ["p1", "p2"] : ["p1"];
  const players = ids.map((id, i): Player => ({
    id, x: WORLD.w * (ids.length === 2 ? 0.35 + i * 0.3 : 0.5), y: WORLD.h * 0.6, r: 20, vx: 0, vy: 0, score: 0, lives: MAX_LIVES, hurtUntil: 0,
    fx: 1, fy: 0, dashUntil: 0, dashReady: 0,
  }));
  const game: Game = { time: 0, timeLeft: ROUND_SECONDS, phase: "playing", players, coins: [], hazards: [], rng, nextCoinId: 1, events: [] };
  for (let i = 0; i < 8; i++) spawnCoin(game);
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2;
    game.hazards.push({ x: 80 + rng() * (WORLD.w - 160), y: 60 + rng() * 200, r: 22, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120 });
  }
  return game;
}

export function spawnCoin(game: Game): void {
  game.coins.push({ id: game.nextCoinId++, x: 40 + game.rng() * (WORLD.w - 80), y: 40 + game.rng() * (WORLD.h - 80), r: 13 });
}

/** One fixed step. `dt` is the loop step in seconds. */
export function stepGame(game: Game, input: Input, dt: number): void {
  if (game.phase !== "playing") return;
  game.time += dt;
  game.timeLeft = Math.max(0, ROUND_SECONDS - game.time);

  for (const p of game.players) {
    if (p.lives <= 0) continue;
    const ax = axisX(input, p.id);
    const ay = axisY(input, p.id);
    const len = Math.hypot(ax, ay);
    const k = len > 1 ? 1 / len : 1;
    if (len > 0.1) {
      p.fx = ax / len;
      p.fy = ay / len;
    }
    if (wasTapped(input, p.id, "a") && game.time >= p.dashReady) {
      p.dashUntil = game.time + DASH_SECONDS;
      p.dashReady = game.time + DASH_COOLDOWN;
      game.events.push({ type: "dash", player: p.id });
    }
    if (game.time < p.dashUntil) {
      p.vx = p.fx * PLAYER_SPEED * DASH_SPEED;
      p.vy = p.fy * PLAYER_SPEED * DASH_SPEED;
    } else {
      p.vx = ax * k * PLAYER_SPEED;
      p.vy = ay * k * PLAYER_SPEED;
    }
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
    if (p.lives <= 0) continue;
    for (let i = game.coins.length - 1; i >= 0; i--) {
      if (circlesOverlap(p, game.coins[i])) {
        game.coins.splice(i, 1);
        p.score += 10;
        game.events.push({ type: "coin", player: p.id });
        spawnCoin(game);
      }
    }
    if (game.time >= p.hurtUntil && p.lives > 0) {
      if (game.hazards.some((h) => circlesOverlap(p, h))) {
        p.lives -= 1;
        p.hurtUntil = game.time + 1.2; // brief invulnerability
        game.events.push({ type: "hurt", player: p.id });
      }
    }
  }

  if (game.timeLeft <= 0 || game.players.every((p) => p.lives <= 0)) game.phase = "over";
}

/** Score for the profile: the best player's score plus a bonus for lives left. */
export function finalScore(game: Game): number {
  return Math.max(...game.players.map((p) => p.score + p.lives * 5));
}

/** Is the player in a dash now? For drawing a trail. */
export const isDashing = (game: Game, p: Player): boolean => game.time < p.dashUntil;

export const UNLOCKS: Unlock[] = [
  { id: "default", label: "Coral runner", description: "Where everyone starts.", scoreAtLeast: 0 },
  { id: "dash", label: "Dash shoes", description: "A sky blue runner.", scoreAtLeast: 100, gameId: GAME_ID },
  { id: "gold", label: "Gold runner", description: "Shiny, for big scores.", scoreAtLeast: 200, gameId: GAME_ID },
  { id: "mint", label: "Mint runner", description: "Cool and calm.", scoreAtLeast: 300, gameId: GAME_ID },
];

/** The runner colour of each unlock. */
export const SKINS: Record<string, string> = { default: "#FF776D", dash: "#4AA3FF", gold: "#FFC23D", mint: "#3CC48B" };

/** A short emoji line for sharing a result, like Wordle. */
export function shareLine(score: number, lives: number, label: string): string {
  return `${label} 🪙 ${score} ${emojiBar(lives, MAX_LIVES, "❤️", "🤍")}`;
}
