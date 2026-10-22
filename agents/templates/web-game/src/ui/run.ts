// One round of play: which mode it is (free, daily, challenge), its seed,
// and what happens when it starts and ends. play.tsx uses `useRun`; the menu
// and results start rounds with `startRun`.
//
// A challenge comes from the page link (?c=&s=&n=) and stays in the link
// until the player leaves it, so a reload keeps it. Its parameters are
// checked by parseChallenge.
import { useCallback, useMemo, useRef, useState } from "react";
import { parseChallenge, randomSeed, type Challenge } from "../game/challenge";
import { currentStreak, dailyNumber, dailySeed, dayKey } from "../game/daily";
import type { RunMode, RunResult, Unlock } from "../game/progress";
import { profileStore } from "./profile-store";
import { router, useRouteParams } from "./router";
import { addPlayTime, track } from "./track";

export type RunSpec = {
  mode: RunMode;
  seed: number;
  /** Daily: the day key ("2026-10-22") and its number from launch day. */
  day?: string;
  dayNumber?: number;
  challenge?: Challenge;
};

/** The friend's challenge in the page link, or null. */
export function activeChallenge(): Challenge | null {
  return typeof location === "undefined" ? null : parseChallenge(location.search);
}

/** Remove the challenge from the page link (the player chose to play normally). */
export function clearChallenge(): void {
  const url = new URL(location.href);
  for (const k of ["c", "s", "n"]) url.searchParams.delete(k);
  history.replaceState(history.state, "", url.toString());
}

/** Today's daily: its key, number, and the player's streak and best today. */
export function todayDaily(launchDay: string, now = new Date()) {
  const key = dayKey(now);
  const daily = profileStore.get().daily;
  return {
    key,
    number: dailyNumber(key, launchDay),
    streak: currentStreak(daily, key),
    bestToday: daily.best[key] as number | undefined,
  };
}

/** Open the game screen in a mode. */
export function startRun(mode: RunMode, how: "push" | "replace" = "push"): void {
  router[how](mode === "free" ? "/play" : `/play?mode=${mode}`);
}

function specFor(mode: RunMode, launchDay: string): RunSpec {
  if (mode === "daily") {
    const key = dayKey(new Date());
    return { mode, seed: dailySeed(key), day: key, dayNumber: dailyNumber(key, launchDay) };
  }
  const challenge = mode === "challenge" ? activeChallenge() : null;
  if (challenge) return { mode, seed: challenge.seed, challenge };
  return { mode: "free", seed: randomSeed() };
}

export type FinishedRound = Omit<RunResult, "gameId" | "mode" | "seed" | "day" | "dayNumber" | "challenge">;

/**
 * The round in play.tsx.
 *   const run = useRun({ gameId: GAME_ID, unlocks: UNLOCKS, launchDay: GAME.launchDay });
 *   createGame(players, run.spec.seed)          // new game when run.round changes
 *   run.step(dt, moved)                         // every game step
 *   run.finish({ score, title, stats, shareLine })
 *   run.restart()                               // pause menu "Restart"
 */
export function useRun({ gameId, unlocks, launchDay }: { gameId: string; unlocks: readonly Unlock[]; launchDay: string }) {
  const params = useRouteParams();
  const mode = (params.get("mode") as RunMode | null) ?? "free";
  const [round, setRound] = useState(0);
  // A new spec per round: free play gets a new random level each time.
  const spec = useMemo(() => specFor(mode, launchDay), [mode, launchDay, round]);
  const started = useRef(-1);
  const finished = useRef(-1);
  const roundRef = useRef(round);
  roundRef.current = round;

  const step = useCallback(
    (dt: number, moved: boolean) => {
      if (started.current !== roundRef.current) {
        if (!moved) return;
        started.current = roundRef.current;
        track("game_start", { mode: spec.mode, round: roundRef.current + 1 });
      }
      addPlayTime(dt);
    },
    [spec.mode],
  );

  const finish = useCallback(
    (result: FinishedRound & { seconds?: number }) => {
      if (finished.current === roundRef.current) return;
      finished.current = roundRef.current;
      const { seconds = 0, ...rest } = result;
      profileStore.finishRun(
        { ...rest, gameId, mode: spec.mode, seed: spec.seed, day: spec.day, dayNumber: spec.dayNumber, challenge: spec.challenge },
        unlocks,
      );
      const p = profileStore.get();
      track("game_over", { mode: spec.mode, score: result.score, best: Boolean(p.lastRun?.newBest), seconds: Math.round(seconds) });
      if (spec.mode === "daily" && spec.dayNumber) {
        track("daily_complete", { day: spec.dayNumber, score: result.score, streak: p.daily.streak });
      }
      router.replace("/results");
    },
    [gameId, unlocks, spec],
  );

  const restart = useCallback(() => setRound((r) => r + 1), []);
  return { spec, round, step, finish, restart };
}
