import { describe, expect, test } from "bun:test";
import { createInput, setAction } from "../src/game/input";
import { createGame, finalScore, ROUND_SECONDS, spawnCoin, stepGame, WORLD } from "../src/games/coin-dash/logic";

const STEP = 1 / 60;

describe("coin dash", () => {
  test("a player collects a coin and a new one appears", () => {
    const game = createGame(1);
    game.hazards = [];
    game.coins = [{ id: 99, x: game.players[0].x + 20, y: game.players[0].y, r: 11 }];
    const input = createInput();
    setAction(input, "p1", "right", true);
    for (let i = 0; i < 10; i++) stepGame(game, input, STEP);
    expect(game.players[0].score).toBe(10);
    expect(game.coins.length).toBe(1);
    expect(game.coins[0].id).not.toBe(99);
  });
  test("a hazard costs a life, then protects briefly", () => {
    const game = createGame(1);
    const p = game.players[0];
    game.hazards = [{ x: p.x, y: p.y, r: 18, vx: 0, vy: 0 }];
    const input = createInput();
    stepGame(game, input, STEP);
    stepGame(game, input, STEP);
    expect(p.lives).toBe(2);
  });
  test("the player cannot leave the world", () => {
    const game = createGame(1);
    game.hazards = [];
    const input = createInput();
    setAction(input, "p1", "left", true);
    for (let i = 0; i < 600; i++) stepGame(game, input, STEP);
    expect(game.players[0].x).toBe(WORLD.x + game.players[0].r);
  });
  test("the round ends when time runs out", () => {
    const game = createGame(2);
    game.hazards = [];
    const input = createInput();
    for (let i = 0; i < (ROUND_SECONDS + 1) * 60; i++) stepGame(game, input, STEP);
    expect(game.phase).toBe("over");
    expect(game.timeLeft).toBe(0);
    expect(game.players.length).toBe(2);
  });
  test("the round ends when every player is out of lives", () => {
    const game = createGame(1);
    game.players[0].lives = 0;
    stepGame(game, createInput(), STEP);
    expect(game.phase).toBe("over");
  });
  test("the score counts coins and lives left", () => {
    const game = createGame(1);
    game.players[0].score = 40;
    expect(finalScore(game)).toBe(55);
    spawnCoin(game);
  });
  test("same seed gives the same level", () => {
    expect(createGame(1, 3).coins).toEqual(createGame(1, 3).coins);
  });
});
