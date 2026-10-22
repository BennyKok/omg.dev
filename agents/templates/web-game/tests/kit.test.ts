import { describe, expect, test } from "bun:test";
import { followCamera, clampCamera, createCamera, screenToWorld, worldToScreen } from "../src/game/camera";
import { angleDiff, circleRectOverlap, circlesOverlap, keepCircleInside, pushCircleOutOfRect, rectsOverlap, seeded } from "../src/game/collision";
import { axisX, axisY, createInput, endFrame, keyToAction, releaseAll, setAction, setStick, wasTapped } from "../src/game/input";
import { createLoop } from "../src/game/loop";
import { emptyProfile, formatTime, isUnlocked, migrateProfile, recordRun, type Unlock } from "../src/game/progress";

describe("loop", () => {
  test("runs one step per 1/60 s regardless of frame size", () => {
    const loop = createLoop();
    let n = 0;
    for (let i = 0; i < 60; i++) loop.advance(1 / 60, () => n++);
    expect(n).toBe(60);
    const slow = createLoop();
    let m = 0;
    for (let i = 0; i < 30; i++) slow.advance(1 / 30, () => m++);
    expect(m).toBe(60);
  });
  test("carries the remainder to the next frame", () => {
    const loop = createLoop({ step: 0.1 });
    expect(loop.advance(0.25, () => {})).toBe(2);
    expect(loop.alpha()).toBeCloseTo(0.5, 5);
    expect(loop.advance(0.05, () => {})).toBe(1);
  });
  test("a long pause does not replay the gap", () => {
    const loop = createLoop({ step: 0.1, maxFrame: 0.25 });
    expect(loop.advance(30, () => {})).toBe(2);
  });
  test("ignores zero and negative time", () => {
    expect(createLoop().advance(0, () => {})).toBe(0);
    expect(createLoop().advance(-1, () => {})).toBe(0);
  });
  test("caps steps per frame and drops the backlog", () => {
    const loop = createLoop({ step: 0.01, maxFrame: 10, maxSteps: 3 });
    expect(loop.advance(1, () => {})).toBe(3);
    expect(loop.advance(0.005, () => {})).toBe(0);
  });
});

describe("input", () => {
  test("held, tapped and axis", () => {
    const input = createInput();
    setAction(input, "p1", "right", true);
    expect(axisX(input, "p1")).toBe(1);
    expect(axisX(input, "p2")).toBe(0);
    setAction(input, "p1", "left", true);
    expect(axisX(input, "p1")).toBe(0);
    setAction(input, "p1", "up", true);
    expect(axisY(input, "p1")).toBe(-1);
    setAction(input, "p1", "a", true);
    expect(wasTapped(input, "p1", "a")).toBe(true);
    endFrame(input);
    expect(wasTapped(input, "p1", "a")).toBe(false);
    setAction(input, "p1", "a", true); // still held: not a new tap
    expect(wasTapped(input, "p1", "a")).toBe(false);
  });
  test("a tap released within the same frame still counts until endFrame", () => {
    const input = createInput();
    setAction(input, "p1", "right", true);
    setAction(input, "p1", "right", false);
    expect(axisX(input, "p1")).toBe(1);
    endFrame(input);
    expect(axisX(input, "p1")).toBe(0);
  });
  test("stick wins over buttons and is limited to length 1", () => {
    const input = createInput();
    setAction(input, "p1", "left", true);
    setStick(input, "p1", 3, 4);
    expect(axisX(input, "p1")).toBeCloseTo(0.6, 5);
    expect(axisY(input, "p1")).toBeCloseTo(0.8, 5);
  });
  test("releaseAll clears everything", () => {
    const input = createInput();
    setAction(input, "p2", "down", true);
    setStick(input, "p2", 1, 1);
    releaseAll(input);
    expect(axisY(input, "p2")).toBe(0);
    expect(axisX(input, "p2")).toBe(0);
  });
  test("keyboard layouts", () => {
    expect(keyToAction("W", 1)).toEqual({ player: "p1", action: "up" });
    expect(keyToAction("ArrowLeft", 1)).toEqual({ player: "p1", action: "left" });
    expect(keyToAction("ArrowLeft", 2)).toEqual({ player: "p2", action: "left" });
    expect(keyToAction("a", 2)).toEqual({ player: "p1", action: "left" });
    expect(keyToAction("Tab", 2)).toBeNull();
  });
});

describe("collision", () => {
  test("circles and rects", () => {
    expect(circlesOverlap({ x: 0, y: 0, r: 5 }, { x: 9, y: 0, r: 5 })).toBe(true);
    expect(circlesOverlap({ x: 0, y: 0, r: 5 }, { x: 10, y: 0, r: 5 })).toBe(false);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(circleRectOverlap({ x: 12, y: 5, r: 3 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    expect(circleRectOverlap({ x: 14, y: 5, r: 3 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(false);
  });
  test("push a circle out of a wall", () => {
    const c = { x: 12, y: 5, r: 4 };
    const n = pushCircleOutOfRect(c, { x: 0, y: 0, w: 10, h: 10 });
    expect(n).toEqual({ x: 1, y: 0 });
    expect(c.x).toBeCloseTo(14, 5);
    expect(pushCircleOutOfRect({ x: 30, y: 5, r: 4 }, { x: 0, y: 0, w: 10, h: 10 })).toBeNull();
    const inside = { x: 9, y: 5, r: 2 };
    expect(pushCircleOutOfRect(inside, { x: 0, y: 0, w: 10, h: 10 })).toEqual({ x: 1, y: 0 });
    expect(inside.x).toBe(12);
  });
  test("keep a circle inside the world", () => {
    const c = { x: -5, y: 50, r: 10 };
    expect(keepCircleInside(c, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: -1, y: 0 });
    expect(c.x).toBe(10);
  });
  test("angle difference takes the short way", () => {
    expect(angleDiff(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2, 5);
  });
  test("seeded random repeats", () => {
    const a = seeded(5);
    const b = seeded(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("camera", () => {
  test("follows the target and converts coordinates both ways", () => {
    const cam = createCamera(0, 0, 2);
    for (let i = 0; i < 300; i++) followCamera(cam, { x: 100, y: 50 }, 1 / 60);
    expect(cam.x).toBeCloseTo(100, 1);
    const s = worldToScreen(cam, { x: 110, y: 50 }, 400, 300);
    expect(s.x).toBeCloseTo(220, 0);
    const w = screenToWorld(cam, s, 400, 300);
    expect(w.x).toBeCloseTo(110, 5);
  });
  test("stays inside the world, and centres a small world", () => {
    const cam = createCamera(0, 0, 1);
    clampCamera(cam, { x: 0, y: 0, w: 1000, h: 1000 }, 200, 100);
    expect(cam.x).toBe(100);
    expect(cam.y).toBe(50);
    clampCamera(cam, { x: 0, y: 0, w: 100, h: 100 }, 200, 300);
    expect(cam.x).toBe(50);
    expect(cam.y).toBe(50);
  });
});

describe("progress", () => {
  const unlocks: Unlock[] = [
    { id: "start", label: "Start", description: "", scoreAtLeast: 0 },
    { id: "gold", label: "Gold", description: "", scoreAtLeast: 100, gameId: "g" },
  ];
  test("records best score and unlocks once", () => {
    let p = recordRun(emptyProfile(), { gameId: "g", score: 120 }, unlocks);
    expect(p.lastRun?.newBest).toBe(true);
    expect(p.lastRun?.newlyUnlocked).toEqual(["start", "gold"]);
    p = recordRun(p, { gameId: "g", score: 50 }, unlocks);
    expect(p.bestScores.g).toBe(120);
    expect(p.lastRun?.newBest).toBe(false);
    expect(p.lastRun?.newlyUnlocked).toEqual([]);
    expect(p.plays).toBe(2);
    expect(isUnlocked(p, "gold", unlocks)).toBe(true);
    expect(isUnlocked(emptyProfile(), "gold", unlocks)).toBe(false);
  });
  test("survives broken saved data", () => {
    expect(migrateProfile("nope")).toEqual(emptyProfile());
    const p = migrateProfile({ settings: { players: 2, sound: "x" }, bestScores: { a: 3, b: "x" }, unlocked: ["a", 5], plays: "q" });
    expect(p.settings.players).toBe(2);
    expect(p.settings.sound).toBe(true);
    expect(p.bestScores).toEqual({ a: 3 });
    expect(p.unlocked).toEqual(["a"]);
    expect(p.plays).toBe(0);
  });
  test("formats time", () => {
    expect(formatTime(83.44)).toBe("1:23.4");
    expect(formatTime(5)).toBe("0:05.0");
  });
});
