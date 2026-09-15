/**
 * THE AGENT IS WORKING — one indicator, one clock.
 *
 * Two surfaces show a coding agent mid-turn: the transcript footer while the
 * turn has produced nothing yet, and the live tool-run row while it is
 * calling things. They used to carry two copies of the same three-dot loop,
 * built on the legacy `Animated` API as three independent `Animated.loop`s
 * per site. Six loops, six JS-thread schedulers, started at six different
 * moments — which is why the footer dots and the row dots visibly ran out of
 * phase with each other.
 *
 * This is the single owner. One shared value per indicator drives every dot
 * on the UI thread through a worklet, so the phase relationship is arithmetic
 * rather than a race between timers, and a busy JS thread — exactly what a
 * streaming agent turn produces — cannot stutter it.
 *
 * The motion itself is a travelling wave, not three separate breaths. Each
 * dot rises and falls through the same bump function offset by a fixed phase,
 * and picks up scale with opacity, so the highlight reads as one thing moving
 * left to right. A coding agent turn runs for minutes; a loop you watch that
 * long has to look intentional rather than merely alive.
 */

import { useEffect } from "react";
import { Text, View, type TextStyle } from "react-native";
import Reanimated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

/** One pass of the wave across all three dots. */
const CYCLE_MS = 1400;
/** Phase offset between neighbouring dots, in cycles. */
const DOT_STAGGER = 0.13;
/** How much of a cycle one dot spends lit. Below this the wave looks like a blink. */
const BUMP_WIDTH = 0.34;
const DOT_COUNT = 3;

const OPACITY_FLOOR = 0.26;
const OPACITY_LIFT = 0.74;
const SCALE_FLOOR = 0.78;
const SCALE_LIFT = 0.34;

/** Opacity a dot holds when the OS asks for reduced motion. */
const STILL_OPACITY = 0.55;

/**
 * A raised-cosine bump: 0 outside the window, 1 at the centre, with no corner
 * at either edge. A triangular ramp is cheaper and looks it — the dot arrives
 * at full brightness and changes direction in the same frame.
 */
function bump(phase: number, width: number): number {
  "worklet";
  // Wrap into [0, 1) so the wave is continuous across the loop boundary
  // instead of resetting to dark between passes.
  const wrapped = ((phase % 1) + 1) % 1;
  const distance = Math.min(wrapped, 1 - wrapped);
  if (distance > width) return 0;
  return (Math.cos((distance / width) * Math.PI) + 1) / 2;
}

/**
 * Drives one wave. Exported so a caller that already owns a clock — a row
 * with several indicators in it — can keep them in lockstep.
 *
 * `enabled` exists because the hook rule forbids skipping the call when a
 * parent hands its own wave down: the component still has to call this, and
 * without the flag it would start a second loop that nothing ever reads.
 */
export function useWorkingWave(enabled = true) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion || !enabled) return;
    progress.value = withRepeat(
      withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [enabled, reducedMotion, progress]);

  return { progress, reducedMotion };
}

function Dot({
  index,
  size,
  color,
  progress,
  reducedMotion,
}: {
  index: number;
  size: number;
  color: string;
  progress: SharedValue<number>;
  reducedMotion: boolean;
}) {
  const animated = useAnimatedStyle(() => {
    const lift = bump(progress.value - index * DOT_STAGGER, BUMP_WIDTH);
    return {
      opacity: OPACITY_FLOOR + lift * OPACITY_LIFT,
      transform: [{ scale: SCALE_FLOOR + lift * SCALE_LIFT }],
    };
  });

  const shape = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
  } as const;

  if (reducedMotion) return <View style={[shape, { opacity: STILL_OPACITY }]} />;
  return <Reanimated.View style={[shape, animated]} />;
}

/**
 * Three dots riding one wave. `size` is the dot diameter: the footer wants a
 * slightly larger mark than the inline tool row, and the gap follows it so
 * the group keeps its proportions at either size.
 */
export function WorkingDots({
  color,
  size = 5,
  wave,
}: {
  color: string;
  size?: number;
  wave?: { progress: SharedValue<number>; reducedMotion: boolean };
}) {
  const own = useWorkingWave(!wave);
  const { progress, reducedMotion } = wave ?? own;

  return (
    <View
      // The dots are decoration; the label beside them carries the meaning.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: "row", alignItems: "center", gap: size * 0.8 }}
    >
      {Array.from({ length: DOT_COUNT }, (_, index) => (
        <Dot
          key={index}
          index={index}
          size={size}
          color={color}
          progress={progress}
          reducedMotion={reducedMotion}
        />
      ))}
    </View>
  );
}

/**
 * The word beside the dots, lit by the same wave one letter at a time.
 *
 * A static "Working" next to a moving mark reads as a caption on the
 * animation. Carrying the wave through the text makes the pair one object,
 * and it is the cue that separates a turn that is running from a turn that
 * stopped with its last line still on screen.
 *
 * Per-character `Text` nodes in a row, not a gradient mask: there is no Skia
 * here, and a masked sweep over a single text node needs a measured width
 * this row does not have.
 */
export function WorkingLabel({
  text,
  color,
  style,
  wave,
}: {
  text: string;
  color: string;
  style: TextStyle;
  wave?: { progress: SharedValue<number>; reducedMotion: boolean };
}) {
  const own = useWorkingWave(!wave);
  const { progress, reducedMotion } = wave ?? own;
  const chars = [...text];

  if (reducedMotion) return <Text style={{ ...style, color }}>{text}</Text>;

  return (
    // One accessible label for the whole row: a screen reader must not read
    // "W o r k i n g".
    <View style={{ flexDirection: "row" }} accessibilityRole="text" accessibilityLabel={text}>
      {chars.map((char, index) => (
        <LabelChar
          // Position IS the identity: the same letter appears more than once
          // and each occurrence lights at a different moment.
          key={`${index}-${char}`}
          char={char}
          index={index}
          total={chars.length}
          color={color}
          style={style}
          progress={progress}
        />
      ))}
    </View>
  );
}

/** The label's wave trails the dots by one dot-width of phase, so the light
 * appears to travel out of the mark and into the word. */
const LABEL_LEAD = DOT_COUNT * DOT_STAGGER;
/** Spread over the word, in characters. Wider than the dot bump because the
 * letters are closer together than the dots are. */
const LABEL_WIDTH = 2.6;
const LABEL_FLOOR = 0.55;
const LABEL_LIFT = 0.45;

function LabelChar({
  char,
  index,
  total,
  color,
  style,
  progress,
}: {
  char: string;
  index: number;
  total: number;
  color: string;
  style: TextStyle;
  progress: SharedValue<number>;
}) {
  const animated = useAnimatedStyle(() => {
    // The head enters before the first letter and leaves after the last, so
    // the word goes quiet between passes rather than the highlight jumping
    // back to the start.
    const span = total + LABEL_WIDTH * 2;
    const head = (((progress.value - LABEL_LEAD) % 1) + 1) % 1;
    const position = head * span - LABEL_WIDTH;
    const lift = Math.max(0, 1 - Math.abs(index - position) / LABEL_WIDTH);
    return { opacity: LABEL_FLOOR + lift * LABEL_LIFT };
  });

  return (
    <Reanimated.View style={animated}>
      <Text style={{ ...style, color }}>{char === " " ? " " : char}</Text>
    </Reanimated.View>
  );
}
