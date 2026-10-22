import { describe, expect, test } from "bun:test";
import { createProfileStore, type ProfileStorage } from "../src/ui/profile-core";
import { dragPlayer, dragPosition, dragStick } from "../src/game/drag";
import { approach, axisX, axisY, createInput, dragTarget, releaseAll, setDragTarget, setStick } from "../src/game/input";
import { stickFromOffset } from "../src/game/stick";
import { createGame, stepGame } from "../src/games/coin-dash/logic";
import { cappedDpr, splitViewports } from "../src/game/view";

function memoryStorage(): ProfileStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("saved progress", () => {
  test("a finished run survives a reload", () => {
    const storage = memoryStorage();
    const before = createProfileStore(storage, "game:profile");
    before.finishRun({ gameId: "g", score: 120 }, [{ id: "gold", label: "Gold", description: "", scoreAtLeast: 100, gameId: "g" }]);
    before.setSettings({ players: 2 });
    before.select("g", "gold");
    const after = createProfileStore(storage, "game:profile"); // a new page load
    expect(after.get().bestScores.g).toBe(120);
    expect(after.get().unlocked).toEqual(["gold"]);
    expect(after.get().settings.players).toBe(2);
    expect(after.get().selected.g).toBe("gold");
    expect(after.get().lastRun?.score).toBe(120);
  });
  test("broken or blocked storage still gives a playable profile", () => {
    const broken = memoryStorage();
    broken.data.set("k", "{not json");
    expect(createProfileStore(broken, "k").get().plays).toBe(0);
    const blocked: ProfileStorage = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
    };
    const store = createProfileStore(blocked, "k");
    store.finishRun({ gameId: "g", score: 5 }, []);
    expect(store.get().bestScores.g).toBe(5);
    expect(createProfileStore(null, "k").get().plays).toBe(0);
  });
  test("subscribers hear every change", () => {
    const store = createProfileStore(memoryStorage(), "k");
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.setSettings({ sound: false });
    off();
    store.setSettings({ sound: true });
    expect(calls).toBe(1);
  });
});

describe("touch stick", () => {
  test("stays inside its radius and gives a unit vector at the edge", () => {
    const s = stickFromOffset(300, 400, 50);
    expect(s.x).toBeCloseTo(0.6, 5);
    expect(s.y).toBeCloseTo(0.8, 5);
    expect(Math.hypot(s.knobX, s.knobY)).toBeCloseTo(50, 5);
  });
  test("a resting thumb near the centre does not move the player", () => {
    expect(stickFromOffset(3, -2, 50)).toEqual({ x: 0, y: 0, knobX: 3, knobY: -2 });
    expect(stickFromOffset(25, 0, 50).x).toBeCloseTo(0.5, 5);
  });
});

describe("drag anywhere", () => {
  // The published Fruit Catcher said "Drag left or right" and nothing moved.
  // These pin the mapping from a finger on the field to the game input.
  test("relative: a finger dragged right moves the player right through axisX, and back left at once", () => {
    const input = createInput();
    let s = dragStick({ x: 200, y: 400 }, { x: 260, y: 400 }, 40);
    setStick(input, "p1", s.x, s.y);
    expect(axisX(input, "p1")).toBe(1);
    expect(s.anchor).toEqual({ x: 220, y: 400 }); // the centre follows the finger
    // Reversing needs only a short move back, not the whole way to the first touch.
    s = dragStick(s.anchor, { x: 180, y: 400 }, 40);
    setStick(input, "p1", s.x, s.y);
    expect(axisX(input, "p1")).toBe(-1);
  });
  test("relative: a resting finger and a lifted finger do not move the player", () => {
    const rest = dragStick({ x: 100, y: 100 }, { x: 103, y: 102 }, 40);
    expect([rest.x, rest.y]).toEqual([0, 0]);
    const input = createInput();
    setStick(input, "p1", 1, 0);
    releaseAll(input);
    expect(axisX(input, "p1")).toBe(0);
  });
  test('axes "x" ignores the vertical part of a drag', () => {
    const s = dragStick({ x: 0, y: 0 }, { x: 20, y: 300 }, 40, "x");
    expect(s.x).toBeCloseTo(0.5, 5);
    expect(s.y).toBe(0);
  });
  test("absolute: the finger gives a 0..1 target on the field, clamped at the edges", () => {
    const field = { left: 10, top: 50, width: 400, height: 800 };
    expect(dragPosition({ x: 110, y: 450 }, field)).toEqual({ x: 0.25, y: 0.5 });
    expect(dragPosition({ x: -30, y: 2000 }, field)).toEqual({ x: 0, y: 1 });
    const input = createInput();
    setDragTarget(input, "p1", dragPosition({ x: 310, y: 450 }, field));
    expect(dragTarget(input, "p1")).toEqual({ x: 0.75, y: 0.5 });
    expect(approach(100, 300, 50)).toBe(150);
    expect(approach(290, 300, 50)).toBe(300);
    releaseAll(input);
    expect(dragTarget(input, "p1")).toBeNull();
  });
  test("two players: the left half of the field is P1, the right half P2", () => {
    const field = { left: 0, width: 400 };
    expect(dragPlayer(100, field, 2)).toBe("p1");
    expect(dragPlayer(300, field, 2)).toBe("p2");
    expect(dragPlayer(300, field, 1)).toBe("p1");
  });
  test("the game rules move the player from a drag with no change to logic.ts", () => {
    const game = createGame(1, 3);
    const input = createInput();
    const x0 = game.players[0].x;
    const s = dragStick({ x: 0, y: 0 }, { x: 80, y: 0 }, 40, "x");
    setStick(input, "p1", s.x, s.y);
    for (let i = 0; i < 30; i++) stepGame(game, input, 1 / 60);
    expect(game.players[0].x).toBeGreaterThan(x0 + 50);
    expect(axisY(input, "p1")).toBe(0);
  });
});

describe("views", () => {
  test("split screen gives each player half the canvas, with a gap, and covers it exactly", () => {
    const [a, b] = splitViewports({ width: 390, height: 604 }, 2, 4);
    expect(a).toEqual({ x: 0, y: 0, w: 390, h: 300 });
    expect(b).toEqual({ x: 0, y: 304, w: 390, h: 300 });
    expect(splitViewports({ width: 390, height: 600 }, 1)).toEqual([{ x: 0, y: 0, w: 390, h: 600 }]);
  });
  test("the pixel ratio is capped for phones", () => {
    expect(cappedDpr(3, 1.5)).toBe(1.5);
    expect(cappedDpr(1, 1.5)).toBe(1);
    expect(cappedDpr(0, 2)).toBe(1);
  });
});
