// Zero-asset UI sound effects. Short, quiet blips synthesized with Web Audio —
// no audio files to ship or fetch. Callers should gate on the user's sound
// preference (see `feedback.ts`); this module just makes noise when asked.
//
// A single shared AudioContext + master gain is lazily created and resumed on
// the triggering gesture (clicks/taps are user gestures, so autoplay policy is
// satisfied). Everything degrades to a no-op where Web Audio is unavailable.
//
// The context is SUSPENDED whenever no blip is playing. A running context is
// an active audio session on iOS: after a dictation take (play-and-record) it
// kept the session in record mode, so the user's music stayed paused for as
// long as the page was open (Benny, 2026-11-01). Each sound resumes it and a
// short timer suspends it again once the last voice has ended.

export type SfxName =
  | "tap"
  | "select"
  | "toggleOn"
  | "toggleOff"
  | "send"
  | "success"
  | "error"
  | "swipe"
  | "open"
  | "close"
  | "receive";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let suspendTimer: ReturnType<typeof setTimeout> | null = null;
// Wall-clock time (ms) when the last scheduled voice is silent.
let quietAt = 0;
// Margin after the last voice ends before the context is suspended, so the
// exponential tail and the oscillator stop are not cut.
const SUSPEND_AFTER_MS = 400;

/** Suspend the context once every scheduled voice has ended. */
function suspendWhenQuiet(endsInMs: number) {
  quietAt = Math.max(quietAt, Date.now() + endsInMs);
  if (suspendTimer) clearTimeout(suspendTimer);
  suspendTimer = setTimeout(() => {
    suspendTimer = null;
    if (ctx?.state === "running") void ctx.suspend().catch(() => {});
  }, Math.max(0, quietAt - Date.now()) + SUSPEND_AFTER_MS);
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5; // overall ceiling; individual voices stay well under
    master.connect(ctx.destination);
  }
  // Browsers suspend the context until a gesture; resume on demand.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/**
 * Build the shared context ahead of the first sound. Creating an AudioContext
 * costs tens of milliseconds, and the first sound is usually the send blip,
 * where it ran inside the keypress before the sent message could paint. It is
 * built in idle time after the first gesture anywhere (a context made before
 * any gesture starts suspended and Chrome warns about it), so by the time a
 * message is sent only the blip itself is left to do.
 */
export function warmSfxOnFirstGesture(enabled: () => boolean): void {
  if (typeof window === "undefined" || ctx) return;
  const events = ["pointerdown", "keydown"] as const;
  const warm = () => {
    for (const type of events) window.removeEventListener(type, warm, true);
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 1));
    idle(() => {
      // Built, then parked: a warm context must not hold the audio session.
      if (enabled() && getCtx()) suspendWhenQuiet(0);
    });
  };
  for (const type of events) window.addEventListener(type, warm, { capture: true, passive: true });
}

type Voice = {
  freq: number;
  toFreq?: number;
  type?: OscillatorType;
  dur: number;
  vol?: number;
  delay?: number;
};

function voice(v: Voice) {
  const c = getCtx();
  if (!c || !master) return;
  const t0 = c.currentTime + (v.delay ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = v.type ?? "sine";
  osc.frequency.setValueAtTime(v.freq, t0);
  if (v.toFreq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, v.toFreq), t0 + v.dur);
  }
  const peak = v.vol ?? 0.16;
  // Fast attack, exponential decay — avoids the click of a hard on/off edge.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + v.dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + v.dur + 0.03);
  suspendWhenQuiet(((v.delay ?? 0) + v.dur + 0.03) * 1000);
}

// Each sound is one or more short voices. Kept low and brief so rapid UI
// interactions never feel noisy or fatiguing.
const KIT: Record<SfxName, Voice[]> = {
  tap: [{ freq: 420, type: "triangle", dur: 0.05, vol: 0.1 }],
  select: [{ freq: 660, type: "sine", dur: 0.045, vol: 0.09 }],
  toggleOn: [{ freq: 520, toFreq: 820, type: "sine", dur: 0.09, vol: 0.13 }],
  toggleOff: [{ freq: 520, toFreq: 340, type: "sine", dur: 0.09, vol: 0.13 }],
  send: [{ freq: 480, toFreq: 920, type: "sine", dur: 0.13, vol: 0.15 }],
  success: [
    { freq: 660, type: "sine", dur: 0.09, vol: 0.13 },
    { freq: 990, type: "sine", dur: 0.13, vol: 0.13, delay: 0.08 },
  ],
  error: [{ freq: 300, toFreq: 170, type: "sawtooth", dur: 0.18, vol: 0.1 }],
  swipe: [{ freq: 600, toFreq: 760, type: "sine", dur: 0.05, vol: 0.08 }],
  open: [{ freq: 500, toFreq: 660, type: "sine", dur: 0.07, vol: 0.09 }],
  close: [{ freq: 660, toFreq: 460, type: "sine", dur: 0.07, vol: 0.09 }],
  receive: [
    { freq: 780, type: "sine", dur: 0.08, vol: 0.1 },
    { freq: 1040, type: "sine", dur: 0.1, vol: 0.08, delay: 0.06 },
  ],
};

export function playSfx(name: SfxName): void {
  const voices = KIT[name];
  if (!voices) return;
  try {
    for (const v of voices) voice(v);
  } catch {
    // Web Audio can throw if the context is closed/blocked — never let a UI
    // sound break the interaction that triggered it.
  }
}
