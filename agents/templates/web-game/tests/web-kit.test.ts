import { describe, expect, test } from "bun:test";
import { createProfileStore, type ProfileStorage } from "../src/ui/profile-core";
import { stickFromOffset } from "../src/game/stick";
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
