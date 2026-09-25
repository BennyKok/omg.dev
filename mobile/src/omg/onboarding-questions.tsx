/**
 * Step 03: three quick questions after a task card, answered by tapping
 * floating bubbles.
 *
 * Benny, 2026-09-25: before the first task starts, let the person say who it
 * is for, what it is about and what it should do, by tapping, never typing.
 * The three answers are built into the prompt (see `compose` in
 * onboarding-tasks.ts), so the first run is theirs rather than a sample.
 *
 * ── The bubbles ───────────────────────────────────────────────────────────
 *
 * The answers are rounded squares in rows of two, in reading order, the rows
 * nudged alternately left and right (see `layout`), under the card's picture.
 * They fly in from outside the screen along their own direction, one after
 * another, then bob gently in place. A tap squeezes the bubble, gives a haptic and a short pop
 * (tap-sound.ts), and moves on. The third tap starts the task.
 */
import { useEffect, useState } from "react";
import { Image, Pressable, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PICTURES } from "./onboarding-cards";
import { StepHeader } from "./onboarding-chrome";
import type { Answer, FirstTask } from "./onboarding-tasks";
import { playPop } from "./tap-sound";
import { Text } from "./text";
import { useTheme } from "./theme";

/** Bubble diameter. Two short lines of a large label fit inside. */
const SIZE = 144;
/** Corner radius: a rounded square, about a quarter of the side. */
const RADIUS = 36;
/** How far each bubble is pushed off the ring, alternately left and right. */
const NUDGE = 10;
/** Wait after a tap so the squeeze and the pop land before the screen moves. */
const ADVANCE_MS = 260;

export function QuestionScreen({
  task,
  step,
  chosen,
  onAnswer,
  onBack,
}: {
  task: FirstTask;
  /** 0, 1 or 2. */
  step: number;
  /** The answer already picked for this question, if they came back to it. */
  chosen: number | null;
  onAnswer: (index: number) => void;
  onBack: () => void;
}) {
  const { colors, space, type } = useTheme();
  const insets = useSafeAreaInsets();
  const question = task.questions[step]!;
  const [area, setArea] = useState<{ width: number; height: number } | null>(null);
  const [tapped, setTapped] = useState<number | null>(null);

  // A new question starts with no tap in flight.
  useEffect(() => setTapped(null), [step]);

  const pick = (index: number) => {
    if (tapped !== null) return;
    setTapped(index);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    playPop();
    setTimeout(() => onAnswer(index), ADVANCE_MS);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <StepHeader onBack={onBack} trailing={`${step + 1} of 3`} />
      {/* The card's picture stays on top (Benny, 2026-09-25): the answers
          float in below it, so the question keeps the card's look. */}
      <Image source={PICTURES[task.key]} style={{ width: "100%", height: 170 }} resizeMode="contain" />
      <View style={{ paddingHorizontal: space.lg + 4, gap: space.xs, marginTop: space.md }}>
        <Text style={{ ...type.headline, color: colors.textMuted }}>{task.title}</Text>
        <Text style={{ ...type.largeTitle, fontSize: 36, lineHeight: 40, color: colors.text }}>{question.title}</Text>
      </View>

      <View
        style={{ flex: 1, marginBottom: insets.bottom }}
        onLayout={(e: LayoutChangeEvent) => setArea(e.nativeEvent.layout)}
      >
        {area
          ? layout(question.answers.length, area).map((spot, index) => (
              <Bubble
                // Keyed by question, so every question's bubbles fly in fresh.
                key={`${step}-${question.answers[index]!.label}`}
                answer={question.answers[index]!}
                index={index}
                spot={spot}
                selected={index === (tapped ?? chosen)}
                onPress={() => pick(index)}
              />
            ))
          : null}
      </View>
    </View>
  );
}

type Spot = { x: number; y: number; size: number; angle: number };

/**
 * Where each answer rests: rows of two in reading order, an odd last one
 * centred, the rows nudged alternately left and right so it reads as a loose
 * stagger rather than a grid. Squares shrink only if the rows would not fit.
 * `angle` points from the middle of the group to the square: it flies in
 * from off screen along that line.
 */
function layout(count: number, area: { width: number; height: number }): Spot[] {
  const margin = 12;
  const gap = 18;
  const rows = Math.ceil(count / 2);
  const size = Math.min(
    SIZE,
    (area.width - margin * 2 - gap - NUDGE * 2) / 2,
    (area.height - margin * 2 - gap * (rows - 1)) / rows,
  );
  const cx = area.width / 2;
  const cy = area.height / 2;
  const top = cy - (rows * size + (rows - 1) * gap) / 2;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / 2);
    const alone = index === count - 1 && count % 2 === 1;
    const col = index % 2;
    const nudge = row % 2 === 0 ? -NUDGE : NUDGE;
    const x = alone ? cx - size / 2 : cx + (col === 0 ? -size - gap / 2 : gap / 2) + nudge;
    const y = top + row * (size + gap);
    return { x, y, size, angle: Math.atan2(y + size / 2 - cy, x + size / 2 - cx) };
  });
}

function Bubble({
  answer,
  index,
  spot,
  selected,
  onPress,
}: {
  answer: Answer;
  index: number;
  spot: Spot;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, type } = useTheme();
  const screen = useWindowDimensions();
  const { x, y, size, angle } = spot;

  // Where it comes from: straight out along its own direction, off screen.
  const far = Math.max(screen.width, screen.height);
  const enter = useSharedValue(1);
  const bob = useSharedValue(0);
  const squeeze = useSharedValue(1);

  useEffect(() => {
    enter.value = withDelay(90 * index, withSpring(0, { damping: 15, stiffness: 110, mass: 0.9 }));
    const period = 1500 + index * 230;
    bob.value = withDelay(
      600 + 90 * index,
      withRepeat(withTiming(1, { duration: period, easing: Easing.inOut(Easing.sin) }), -1, true),
    );
  }, [enter, bob, index]);

  useEffect(() => {
    if (selected) squeeze.value = withSequence(withTiming(0.88, { duration: 90 }), withSpring(1.06, { damping: 9 }));
  }, [selected, squeeze]);

  const style = useAnimatedStyle(() => ({
    opacity: 1 - enter.value * 0.9,
    transform: [
      { translateX: Math.cos(angle) * far * enter.value },
      { translateY: Math.sin(angle) * far * enter.value + (bob.value - 0.5) * 8 },
      { scale: squeeze.value },
    ],
  }));

  return (
    <Reanimated.View style={[{ position: "absolute", left: x, top: y, width: size, height: size }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={answer.label}
        onPress={onPress}
        style={{
          flex: 1,
          // Rounded squares, not circles (Benny, 2026-09-25), with the
          // continuous corner curve iOS uses for its own tiles.
          borderRadius: RADIUS,
          borderCurve: "continuous",
          alignItems: "center",
          justifyContent: "center",
          padding: 14,
          backgroundColor: selected ? colors.text : colors.card,
          borderWidth: 1,
          borderColor: selected ? colors.text : colors.border,
        }}
      >
        <Text
          numberOfLines={2}
          style={{ ...type.headline, fontSize: 22, lineHeight: 26, textAlign: "center", color: selected ? colors.bg : colors.text }}
        >
          {answer.label}
        </Text>
      </Pressable>
    </Reanimated.View>
  );
}
