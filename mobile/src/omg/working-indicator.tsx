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
import { Text, View, type TextStyle, type ViewStyle } from "react-native";
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

/** The first appearance reads left-to-right before the steady wave takes over. */
const REVEAL_MS = 620;
/** Each item overlaps the next, so the entrance is a wipe rather than a typewriter. */
const REVEAL_WINDOW = 0.48;

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

/** Smoothly reveal one item at its position in a left-to-right sequence. */
function revealAt(progress: number, index: number, total: number): number {
  "worklet";
  const start = total <= 1 ? 0 : (index / (total - 1)) * (1 - REVEAL_WINDOW);
  const linear = Math.max(0, Math.min(1, (progress - start) / REVEAL_WINDOW));
  return linear * linear * (3 - 2 * linear);
}

type WorkingWave = {
  progress: SharedValue<number>;
  reveal: SharedValue<number>;
  reducedMotion: boolean;
};

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
  const reveal = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion || !enabled) return;
    reveal.value = withTiming(1, {
      duration: REVEAL_MS,
      easing: Easing.out(Easing.cubic),
    });
    progress.value = withRepeat(
      withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(progress);
      cancelAnimation(reveal);
    };
  }, [enabled, reducedMotion, progress, reveal]);

  return { progress, reveal, reducedMotion };
}

function Dot({
  index,
  size,
  color,
  progress,
  reveal,
  revealIndex,
  revealTotal,
  reducedMotion,
}: {
  index: number;
  size: number;
  color: string;
  progress: SharedValue<number>;
  reveal: SharedValue<number>;
  revealIndex: number;
  revealTotal: number;
  reducedMotion: boolean;
}) {
  const animated = useAnimatedStyle(() => {
    const lift = bump(progress.value - index * DOT_STAGGER, BUMP_WIDTH);
    const entrance = revealAt(reveal.value, revealIndex, revealTotal);
    return {
      opacity: entrance * (OPACITY_FLOOR + lift * OPACITY_LIFT),
      transform: [
        { translateX: (1 - entrance) * -size },
        { scale: entrance * (SCALE_FLOOR + lift * SCALE_LIFT) },
      ],
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
  revealOffset = 0,
  revealTotal = DOT_COUNT,
}: {
  color: string;
  size?: number;
  wave?: WorkingWave;
  revealOffset?: number;
  revealTotal?: number;
}) {
  const own = useWorkingWave(!wave);
  const { progress, reveal, reducedMotion } = wave ?? own;

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
          reveal={reveal}
          revealIndex={revealOffset + index}
          revealTotal={revealTotal}
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
  revealOffset = 0,
  revealTotal,
}: {
  text: string;
  color: string;
  style: TextStyle;
  wave?: WorkingWave;
  revealOffset?: number;
  revealTotal?: number;
}) {
  const own = useWorkingWave(!wave);
  const { progress, reveal, reducedMotion } = wave ?? own;
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
          reveal={reveal}
          revealIndex={revealOffset + index}
          revealTotal={revealTotal ?? chars.length}
        />
      ))}
    </View>
  );
}

/**
 * The complete footer indicator. Its entrance and steady motion share one
 * clock, so the first reveal flows from the dots into the word and the wave
 * then keeps following the same route.
 */
export function WorkingIndicator({
  text,
  dotColor,
  labelColor,
  labelStyle,
  dotSize = 5,
  gap = 6,
  style,
}: {
  text: string;
  dotColor: string;
  labelColor: string;
  labelStyle: TextStyle;
  dotSize?: number;
  gap?: number;
  style?: ViewStyle;
}) {
  const wave = useWorkingWave();
  const revealTotal = DOT_COUNT + [...text].length;

  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>
      <WorkingDots color={dotColor} size={dotSize} wave={wave} revealTotal={revealTotal} />
      <WorkingLabel
        text={text}
        color={labelColor}
        style={labelStyle}
        wave={wave}
        revealOffset={DOT_COUNT}
        revealTotal={revealTotal}
      />
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
  reveal,
  revealIndex,
  revealTotal,
}: {
  char: string;
  index: number;
  total: number;
  color: string;
  style: TextStyle;
  progress: SharedValue<number>;
  reveal: SharedValue<number>;
  revealIndex: number;
  revealTotal: number;
}) {
  const animated = useAnimatedStyle(() => {
    // The head enters before the first letter and leaves after the last, so
    // the word goes quiet between passes rather than the highlight jumping
    // back to the start.
    const span = total + LABEL_WIDTH * 2;
    const head = (((progress.value - LABEL_LEAD) % 1) + 1) % 1;
    const position = head * span - LABEL_WIDTH;
    const lift = Math.max(0, 1 - Math.abs(index - position) / LABEL_WIDTH);
    const entrance = revealAt(reveal.value, revealIndex, revealTotal);
    return {
      opacity: entrance * (LABEL_FLOOR + lift * LABEL_LIFT),
      transform: [{ translateX: (1 - entrance) * -2 }],
    };
  });

  return (
    <Reanimated.View style={animated}>
      <Text style={{ ...style, color }}>{char === " " ? " " : char}</Text>
    </Reanimated.View>
  );
}
