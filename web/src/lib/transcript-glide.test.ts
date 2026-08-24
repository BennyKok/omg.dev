import { describe, expect, test } from "bun:test";

import {
  completeTranscriptGlideFrame,
  createTranscriptGlideState,
  nextTranscriptGlideFrame,
  transcriptGlideAction,
  TRANSCRIPT_GLIDE_SPRING,
} from "./transcript-glide";

type Simulation = {
  elapsedMs: number;
  scrollTop: number;
  state: ReturnType<typeof createTranscriptGlideState>;
};

function simulate(frameMs: number, targetAt: (elapsedMs: number) => number): Simulation {
  let elapsedMs = 0;
  let scrollTop = 0;
  let state = createTranscriptGlideState();

  for (let frame = 0; frame < 600; frame += 1) {
    const target = targetAt(elapsedMs);
    const distance = target - scrollTop;
    if (Math.abs(distance) < 1) return { elapsedMs, scrollTop, state };

    const next = nextTranscriptGlideFrame(state, distance, elapsedMs);
    const previous = scrollTop;
    scrollTop = Math.min(target, Math.max(0, scrollTop + next.offsetPx));
    state = completeTranscriptGlideFrame(next.state, scrollTop !== previous);
    elapsedMs += frameMs;
  }

  throw new Error("spring did not settle");
}

describe("the transcript glide spring", () => {
  test("uses the AI Elements spring defaults", () => {
    expect(TRANSCRIPT_GLIDE_SPRING).toEqual({
      damping: 0.7,
      stiffness: 0.05,
      mass: 1.25,
    });
  });

  test("is time-corrected across 60 Hz and 120 Hz displays", () => {
    const at60Hz = simulate(1000 / 60, () => 100);
    const at120Hz = simulate(1000 / 120, () => 100);

    expect(Math.abs(100 - at60Hz.scrollTop)).toBeLessThan(1);
    expect(Math.abs(100 - at120Hz.scrollTop)).toBeLessThan(1);
    expect(Math.abs(at60Hz.elapsedMs - at120Hz.elapsedMs)).toBeLessThan(100);
  });

  test("chases a target that grows while the same spring stays active", () => {
    const result = simulate(1000 / 60, (elapsedMs) => (elapsedMs < 150 ? 100 : 180));

    expect(Math.abs(180 - result.scrollTop)).toBeLessThan(1);
    expect(result.elapsedMs).toBeLessThan(1200);
  });

  test("retains unapplied distance until a scroll write moves the pane", () => {
    const initial = createTranscriptGlideState();
    const primed = nextTranscriptGlideFrame(initial, 100, 0);
    const moving = nextTranscriptGlideFrame(primed.state, 100, 1000 / 60);
    const clamped = completeTranscriptGlideFrame(moving.state, false);
    const applied = completeTranscriptGlideFrame(moving.state, true);

    expect(moving.offsetPx).toBeGreaterThan(0);
    expect(clamped.accumulatedOffsetPx).toBe(moving.offsetPx);
    expect(applied.accumulatedOffsetPx).toBe(0);
  });
});

describe("transcript follow action", () => {
  const action = (overrides: Partial<Parameters<typeof transcriptGlideAction>[0]> = {}) =>
    transcriptGlideAction({
      discrete: false,
      reengaged: false,
      reducedMotion: false,
      running: false,
      ...overrides,
    });

  test("a message, tool row, or indicator change starts a glide", () => {
    expect(action({ discrete: true })).toBe("start");
  });

  test("ordinary stream growth does not cancel a glide already in flight", () => {
    expect(action({ running: true })).toBe("continue");
  });

  test("another discrete arrival lets the live glide keep chasing its target", () => {
    expect(action({ discrete: true, running: true })).toBe("continue");
  });

  test("a manual jump to latest deliberately restarts the glide", () => {
    expect(action({ discrete: true, reengaged: true, running: true })).toBe("start");
  });

  test("ordinary stream growth still snaps when no glide is active", () => {
    expect(action()).toBe("snap");
  });

  test("reduced motion always snaps", () => {
    expect(action({ discrete: true, running: true, reducedMotion: true })).toBe("snap");
  });
});
