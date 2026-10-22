// Sound effects made in code with the Web Audio API (no audio files), and
// optional vibration.
//
//   sound.play("coin");        vibrate(30);
//
// Browsers block audio until the player taps or presses a key, so the audio
// context starts on the first tap (unlockAudioOnFirstTap, called by page.ts).
// Before that, play() does nothing. The mute choice is the saved setting
// `sound` (profileStore.setSettings({ sound })), so it survives a reload.
// Add a sound: one entry in SOUNDS.
import { profileStore } from "./profile-store";

type Note = { freq: number; to?: number; at?: number; dur: number; type?: OscillatorType; gain?: number };

/** Each sound is a few short notes. `to` slides the pitch; `at` delays the note (s). */
export const SOUNDS = {
  tap: [{ freq: 520, dur: 0.05, type: "triangle", gain: 0.12 }],
  coin: [{ freq: 988, dur: 0.06, type: "square", gain: 0.06 }, { freq: 1319, at: 0.06, dur: 0.12, type: "square", gain: 0.06 }],
  dash: [{ freq: 220, to: 660, dur: 0.14, type: "sawtooth", gain: 0.05 }],
  hurt: [{ freq: 300, to: 90, dur: 0.25, type: "sawtooth", gain: 0.09 }],
  win: [523, 659, 784, 1047].map((freq, i) => ({ freq, at: i * 0.09, dur: 0.16, type: "triangle" as const, gain: 0.12 })),
  lose: [392, 330, 262].map((freq, i) => ({ freq, at: i * 0.14, dur: 0.22, type: "triangle" as const, gain: 0.12 })),
} satisfies Record<string, Note[]>;

export type SoundName = keyof typeof SOUNDS;

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Start audio on the first tap or key press. Safe to call many times. */
export function unlockAudioOnFirstTap(): void {
  if (typeof window === "undefined") return;
  const unlock = () => {
    const c = context();
    if (c && c.state === "suspended") void c.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

export const sound = {
  /** Plays when sound is on and audio has started. Never throws. */
  play(name: SoundName): void {
    if (!profileStore.get().settings.sound || !ctx || ctx.state !== "running") return;
    try {
      const now = ctx.currentTime;
      for (const n of SOUNDS[name] as Note[]) {
        const t = now + (n.at ?? 0);
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = n.type ?? "sine";
        osc.frequency.setValueAtTime(n.freq, t);
        if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t + n.dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(n.gain ?? 0.1, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
        osc.connect(g).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + n.dur + 0.02);
      }
    } catch {
      // Audio is a nice-to-have.
    }
  },
  get on(): boolean {
    return profileStore.get().settings.sound;
  },
  /** Mute or unmute, remembered on this device. */
  setOn(on: boolean): void {
    profileStore.setSettings({ sound: on });
  },
};

/** A short vibration, when the setting is on and the phone supports it. Fails silently. */
export function vibrate(pattern: number | number[]): void {
  if (!profileStore.get().settings.vibrate) return;
  try {
    (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate?.(pattern);
  } catch {
    // Not supported (iOS Safari, desktop): nothing to do.
  }
}
