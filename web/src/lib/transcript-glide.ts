export type TranscriptGlideState = {
  lastTickMs: number | null;
  velocityPx: number;
  accumulatedOffsetPx: number;
};

export type TranscriptGlideAction = "start" | "continue" | "snap";

/**
 * Decide how transcript growth interacts with the current glide.
 *
 * Once a discrete arrival starts a glide, later streamed text and tool status
 * changes must leave it alive. Its RAF reads the new bottom every frame. A
 * snap is still correct for ordinary streaming when no glide is in flight.
 */
export function transcriptGlideAction({
  discrete,
  reengaged,
  reducedMotion,
  running,
}: {
  discrete: boolean;
  reengaged: boolean;
  reducedMotion: boolean;
  running: boolean;
}): TranscriptGlideAction {
  if (reducedMotion) return "snap";
  if (reengaged) return "start";
  if (running) return "continue";
  return discrete ? "start" : "snap";
}

/**
 * The spring used by AI Elements through use-stick-to-bottom, with slightly
 * higher stiffness so transcript arrivals settle sooner without losing the
 * spring's gradual takeoff.
 *
 * The constants and frame integration are adapted from the MIT-licensed
 * use-stick-to-bottom implementation:
 * https://github.com/StackBlitzLabs/use-stick-to-bottom/blob/8d6a19a0ca6ab632830588073e6a29312a06a088/src/useStickToBottom.ts
 */
export const TRANSCRIPT_GLIDE_SPRING = {
  damping: 0.7,
  stiffness: 0.06,
  mass: 1.25,
} as const;

const SIXTY_FPS_INTERVAL_MS = 1000 / 60;

export function createTranscriptGlideState(): TranscriptGlideState {
  return {
    lastTickMs: null,
    velocityPx: 0,
    accumulatedOffsetPx: 0,
  };
}

/**
 * Advance one animation frame without reading or writing the DOM.
 *
 * The live distance is an input on every frame. This lets one spring follow a
 * transcript whose bottom keeps moving as streamed text changes its height.
 */
export function nextTranscriptGlideFrame(
  state: TranscriptGlideState,
  distancePx: number,
  tickMs: number,
): { state: TranscriptGlideState; offsetPx: number } {
  const elapsedFrames = (tickMs - (state.lastTickMs ?? tickMs)) / SIXTY_FPS_INTERVAL_MS;
  const velocityPx = (
    TRANSCRIPT_GLIDE_SPRING.damping * state.velocityPx
    + TRANSCRIPT_GLIDE_SPRING.stiffness * distancePx
  ) / TRANSCRIPT_GLIDE_SPRING.mass;
  const accumulatedOffsetPx = state.accumulatedOffsetPx + velocityPx * elapsedFrames;

  return {
    state: {
      lastTickMs: tickMs,
      velocityPx,
      accumulatedOffsetPx,
    },
    offsetPx: accumulatedOffsetPx,
  };
}

/**
 * A successful scroll write consumed the accumulated offset. If the browser
 * clamped the write, retain it for the next frame, as use-stick-to-bottom does.
 */
export function completeTranscriptGlideFrame(
  state: TranscriptGlideState,
  didMove: boolean,
): TranscriptGlideState {
  if (!didMove) return state;
  return { ...state, accumulatedOffsetPx: 0 };
}
