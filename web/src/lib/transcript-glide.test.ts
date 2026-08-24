import { describe, expect, test } from "bun:test";

import {
  completeTranscriptGlideFrame,
  createTranscriptGlideState,
  nextTranscriptGlideFrame,
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
