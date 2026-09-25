/**
 * A short "pop" for onboarding's answer bubbles (Benny, 2026-09-25).
 *
 * ── Guarded, because an over-the-air update can reach an older binary ─────
 *
 * `expo-audio` is native. A JS bundle that imports it on a binary built
 * without it dies at import (see in-app-browser.ts for the crash this pattern
 * came from). So the module is asked for with `requireOptionalNativeModule`
 * first, and on a binary without it `playPop()` is silent rather than fatal.
 *
 * ── Playback only ─────────────────────────────────────────────────────────
 *
 * No config plugin and no microphone permission: `expo-audio`'s plugin writes
 * a microphone purpose string, and a generic one got build 34 rejected. The
 * player follows the silent switch by default, which is right for a UI sound.
 */
import { requireOptionalNativeModule } from "expo-modules-core";

type Player = { seekTo: (seconds: number) => unknown; play: () => void; volume: number };

let player: Player | null | undefined;

function getPlayer(): Player | null {
  if (player !== undefined) return player;
  player = null;
  if (!requireOptionalNativeModule("ExpoAudio")) return player;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createAudioPlayer } = require("expo-audio") as {
      createAudioPlayer: (source: number) => Player;
    };
    player = createAudioPlayer(require("../../assets/sounds/bubble-pop.wav"));
    player.volume = 0.6;
  } catch {
    player = null;
  }
  return player;
}

/** Play the pop from the start. Never throws; a missing player is silence. */
export function playPop(): void {
  const p = getPlayer();
  if (!p) return;
  try {
    void p.seekTo(0);
    p.play();
  } catch {
    // A UI sound must never break the tap it decorates.
  }
}
