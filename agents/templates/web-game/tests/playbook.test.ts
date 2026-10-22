import { describe, expect, test } from "bun:test";
import { challengeOutcome, challengeUrl, cleanName, parseChallenge } from "../src/game/challenge";
import { currentStreak, dailyNumber, dailySeed, dayKey, emptyDaily, recordDaily } from "../src/game/daily";
import { createInput, setAction } from "../src/game/input";
import { emptyProfile, migrateProfile, recordRun } from "../src/game/progress";
import { createGame, stepGame } from "../src/games/coin-dash/logic";

describe("daily challenge", () => {
  test("every player gets the same level on the same day, and a new one the next day", () => {
    const today = dayKey(new Date(2026, 9, 22, 23, 59));
    expect(today).toBe("2026-10-22");
    expect(dailySeed(today)).toBe(dailySeed(dayKey(new Date(2026, 9, 22, 0, 1))));
    expect(dailySeed(today)).not.toBe(dailySeed("2026-10-23"));
    expect(createGame(1, dailySeed(today)).coins).toEqual(createGame(1, dailySeed(today)).coins);
  });
  test("is numbered from launch day", () => {
    expect(dailyNumber("2026-10-22", "2026-10-22")).toBe(1);
    expect(dailyNumber("2026-11-01", "2026-10-22")).toBe(11);
    expect(dailyNumber("2026-10-01", "2026-10-22")).toBe(1);
  });
  test("the streak grows on consecutive days, survives a replay, and resets after a missed day", () => {
    let d = recordDaily(emptyDaily(), "2026-10-22", 50);
    d = recordDaily(d, "2026-10-23", 40);
    expect(d.streak).toBe(2);
    d = recordDaily(d, "2026-10-23", 90);
    expect(d.streak).toBe(2);
    expect(d.best["2026-10-23"]).toBe(90);
    expect(currentStreak(d, "2026-10-24")).toBe(2);
    expect(currentStreak(d, "2026-10-25")).toBe(0);
    expect(recordDaily(d, "2026-10-26", 10).streak).toBe(1);
  });
  test("a finished daily run updates the saved streak", () => {
    const p = recordRun(emptyProfile(), { gameId: "g", score: 30, mode: "daily", day: "2026-10-22" }, []);
    expect(p.daily.streak).toBe(1);
    expect(migrateProfile(JSON.parse(JSON.stringify(p))).daily.best["2026-10-22"]).toBe(30);
    expect(recordRun(emptyProfile(), { gameId: "g", score: 30 }, []).daily.streak).toBe(0);
  });
});

describe("challenge links", () => {
  test("a link round-trips seed, score and name", () => {
    const url = challengeUrl("https://coin.example/", { seed: 123456, score: 240, name: "Ana" });
    expect(url).toBe("https://coin.example/?c=123456&s=240&n=Ana");
    expect(parseChallenge(new URL(url).search)).toEqual({ seed: 123456, score: 240, name: "Ana" });
  });
  test("bad or hostile parameters are rejected or cleaned", () => {
    expect(parseChallenge("")).toBeNull();
    expect(parseChallenge("?c=abc&s=1")).toBeNull();
    expect(parseChallenge("?c=0&s=1")).toBeNull();
    expect(parseChallenge("?c=1e9&s=1")).toBeNull();
    expect(parseChallenge("?c=99999999999&s=1")).toBeNull();
    expect(parseChallenge("?c=5&s=-3")).toBeNull();
    expect(parseChallenge("?c=5")).toBeNull();
    expect(parseChallenge("?c=5&s=10")?.name).toBe("A friend");
    const evil = parseChallenge(`?c=5&s=10&n=${encodeURIComponent("<img src=x onerror=alert(1)>Bob the very long name")}`);
    expect(evil?.name).toBe("img srcx onerror");
    expect(cleanName("  Zoë   O'Neil  ")).toBe("Zoë O'Neil");
  });
  test("the result is a win, a loss or a tie", () => {
    expect(challengeOutcome(10, 5)).toBe("won");
    expect(challengeOutcome(5, 10)).toBe("lost");
    expect(challengeOutcome(5, 5)).toBe("tie");
  });
  test("the same seed replays the same level for the friend", () => {
    const a = createGame(1, 987654);
    const b = createGame(1, 987654);
    const input = createInput();
    for (let i = 0; i < 120; i++) {
      stepGame(a, input, 1 / 60);
      stepGame(b, input, 1 / 60);
    }
    expect(a.hazards).toEqual(b.hazards);
    expect(a.coins).toEqual(b.coins);
  });
});

describe("coin dash dash", () => {
  test("dash moves the runner further than walking, then needs a cool-down", () => {
    const walk = createGame(1);
    walk.hazards = [];
    const dash = createGame(1);
    dash.hazards = [];
    const wi = createInput();
    const di = createInput();
    setAction(wi, "p1", "right", true);
    setAction(di, "p1", "right", true);
    setAction(di, "p1", "a", true);
    for (let i = 0; i < 12; i++) {
      stepGame(walk, wi, 1 / 60);
      stepGame(dash, di, 1 / 60);
      di.p1.tapped.a = false;
    }
    expect(dash.players[0].x).toBeGreaterThan(walk.players[0].x + 20);
    expect(dash.events.filter((e) => e.type === "dash")).toHaveLength(1);
  });
});
