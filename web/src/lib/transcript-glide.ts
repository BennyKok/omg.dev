export type TranscriptGlideState = {
  lastTickMs: number | null;
  velocityPx: number;
  accumulatedOffsetPx: number;
};

export type TranscriptGlideAction = "start" | "continue" | "snap" | "hold";

/** Follow new content immediately. Only an explicit return to latest starts
 * a glide; subsequent growth lets that user-requested glide finish.
 *
 * "hold" means write nothing. A reader's drag or coasting flick owns the pane:
 * a `scrollTop` write then stops the momentum dead and, at the end of the
 * list, restarts the rubber-band bounce, so the view stutters and snaps to the
 * end under the reader's thumb. Scrolling down into the bottom slack re-pins
 * the transcript while that flick is still moving, so this was the common
 * path, not a corner case. The native client holds for the same reason (see
 * `touchingRef` in mobile/app/session/[id].tsx). ChatStream runs the follow
 * again once scroll events stop, and that run glides the rest of the way. */
export function transcriptGlideAction({
  reengaged,
  reducedMotion,
  running,
  gestureLive,
}: {
  reengaged: boolean;
  reducedMotion: boolean;
  running: boolean;
  /** A reader's gesture or its momentum is still moving the pane. */
  gestureLive: boolean;
}): TranscriptGlideAction {
  if (gestureLive) return "hold";
  if (reducedMotion) return "snap";
  if (reengaged) return "start";
  if (running) return "continue";
  return "snap";
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
