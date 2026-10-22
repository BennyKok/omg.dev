// One analytics call for the whole game: track(name, data).
//
// It always logs to the console ("[track] game_start {...}"). On a page
// published by omg.dev, the build adds the omg analytics script (Umami), and
// track() also sends each event there as a custom event, once. The page view
// itself is counted by that script, so do not send a page view here.
//
// To use another tool (Google Analytics, the Meta pixel), add it in `send`
// below. Keep the event names: ads and dashboards depend on them.
import type { RunMode } from "../game/progress";
import { TEST_MODE } from "../game/test-mode";

export type TrackEvents = {
  /** The page loaded. Sent once per page load by the kit. */
  game_open: { mode?: RunMode };
  /** The first move of a round. */
  game_start: { mode: RunMode; round: number };
  /** A round ended. */
  game_over: { mode: RunMode; score: number; best: boolean; seconds: number };
  /** 45 seconds of play in total in this visit. Sent once per page load. */
  play_engaged: { seconds: number };
  /** A result or a challenge link was shared or copied. */
  share: { kind: "result" | "challenge" | "send_back"; method: "share" | "copy" };
  /** Someone opened a valid challenge link. */
  challenge_open: { score: number };
  /** The daily challenge was finished. */
  daily_complete: { day: number; score: number; streak: number };
};

export type TrackName = keyof TrackEvents;

type Umami = { track: (name: string, data?: Record<string, unknown>) => unknown };

const queue: [string, Record<string, unknown>][] = [];
let waiting = false;

function umami(): Umami | null {
  const u = (globalThis as { umami?: Umami }).umami;
  return u && typeof u.track === "function" ? u : null;
}

/** The analytics script tag the omg build adds, if this page has one. */
function analyticsScript(): HTMLScriptElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLScriptElement>("script[data-website-id]");
}

function send(name: string, data: Record<string, unknown>): void {
  if (TEST_MODE) return; // check:play (?test=1) is not a player
  const u = umami();
  if (u) {
    try {
      u.track(name, data);
    } catch {
      // Analytics must never break the game.
    }
    return;
  }
  // The script loads with `defer` and may not be ready yet: hold the event
  // and send it once when the script has loaded. No script: console only.
  const script = analyticsScript();
  if (!script) return;
  queue.push([name, data]);
  if (waiting) return;
  waiting = true;
  script.addEventListener("load", () => {
    waiting = false;
    const ready = umami();
    for (const [n, d] of queue.splice(0)) {
      try {
        ready?.track(n, d);
      } catch {
        // ignore
      }
    }
  }, { once: true });
}

const once = new Set<TrackName>();

export function track<N extends TrackName>(name: N, data: TrackEvents[N]): void {
  // game_open and play_engaged count once per page load, however often the code calls them.
  if (name === "game_open" || name === "play_engaged") {
    if (once.has(name)) return;
    once.add(name);
  }
  console.info("[track]", name, data);
  send(name, data as Record<string, unknown>);
}

/** Seconds of play in this page load. play.tsx adds each game step; 45 s sends play_engaged. */
let played = 0;
export const ENGAGED_SECONDS = 45;
export function addPlayTime(dt: number): void {
  played += dt;
  if (played >= ENGAGED_SECONDS) track("play_engaged", { seconds: ENGAGED_SECONDS });
}
