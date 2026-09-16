import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, View, type LayoutRectangle, type TextStyle } from "react-native";
import Animated, {
  cancelAnimation, Easing, interpolateColor, runOnJS, type SharedValue, useAnimatedStyle,
  useSharedValue, withRepeat, withTiming,
} from "react-native-reanimated";
import { Text } from "./text";
import { useReduceMotionEnabled } from "./motion";
import { useTheme } from "./theme";

const SPACING = 10;
const GROUPS = 24;
const AnimatedText = Animated.createAnimatedComponent(Text);

type Activity = {
  phase: SharedValue<number>;
  visibility: SharedValue<number>;
  present: boolean;
  reducedMotion: boolean;
};

/** One row clock drives both its title and its field, including entry/exit. */
export function useSessionActivity(active: boolean): Activity {
  const reducedMotion = useReduceMotionEnabled();
  const phase = useSharedValue(0);
  const visibility = useSharedValue(0);
  const [retained, setRetained] = useState(active);
  const activeRef = useRef(active);
  activeRef.current = active;
  const finishExit = useCallback(() => {
    if (!activeRef.current) setRetained(false);
  }, []);
  useEffect(() => {
    cancelAnimation(visibility);
    if (active) setRetained(true);
    if (reducedMotion) {
      visibility.value = active ? 1 : 0;
      setRetained(active);
    } else {
      visibility.value = withTiming(active ? 1 : 0, { duration: active ? 420 : 650 }, (finished) => {
        if (finished && !active) runOnJS(finishExit)();
      });
    }
    return () => cancelAnimation(visibility);
  }, [active, reducedMotion, visibility, finishExit]);
  const present = active || retained;
  useEffect(() => {
    const update = () => {
      cancelAnimation(phase);
      phase.value = 0;
      if (present && !reducedMotion && AppState.currentState === "active") {
        // Keep the wave at 2.2s while the ambient breath spans the full loop.
        phase.value = withRepeat(withTiming(4, { duration: 8800, easing: Easing.linear }), -1, false);
      }
    };
    update();
    const subscription = AppState.addEventListener("change", update);
    return () => { subscription.remove(); cancelAnimation(phase); };
  }, [present, phase, reducedMotion]);
  return { phase, visibility, present, reducedMotion };
}

/** A broad highlight travels left to right, then clears the edge before looping. */
export function activityWave(phase: number, position: number): number {
  "worklet";
  const wavePhase = phase % 1;
  const distance = Math.abs(position - (wavePhase * 1.6 - 0.3));
  return distance >= 0.3 ? 0 : (1 + Math.cos(distance / 0.3 * Math.PI)) / 2;
}

/** One gentle 8.8-second breath beneath four unchanged 2.2-second waves. */
export function activityBreath(phase: number, position: number, variant: number): number {
  "worklet";
  const pulse = (1 + Math.cos((phase / 4 - variant / 3 - position * 3.7) * Math.PI * 2)) / 2;
  return pulse * pulse;
}

export function activitySparkle(phase: number, position: number, variant: number): number {
  "worklet";
  const breath = activityBreath(phase, position, variant);
  return breath * 0.5 + breath * activityWave(phase, position) * 0.5;
}

function TitleLetter({ char, position, activity, color, mutedColor }: {
  char: string; position: number; activity: Activity; color: string; mutedColor: string;
}) {
  const style = useAnimatedStyle(() => ({
    color: interpolateColor(activity.reducedMotion ? 1 :
      1 - activity.visibility.value * 0.65 * (1 - activityWave(activity.phase.value, position)),
    [0, 1], [mutedColor, color]),
  }));
  return <AnimatedText style={style}>{char}</AnimatedText>;
}

/** Nested text preserves native truncation and shaping, including long titles. */
export function SessionActivityTitle({ title, activity, style }: {
  title: string; activity: Activity; style: TextStyle;
}) {
  const { colors } = useTheme();
  return <Text numberOfLines={1} accessibilityLabel={title} style={style}>
    {activity.present && !activity.reducedMotion ? [...title].map((char, index, chars) =>
      <TitleLetter key={index} char={char} position={index / Math.max(1, chars.length - 1)}
        activity={activity} color={colors.text} mutedColor={colors.textMuted} />) : title}
  </Text>;
}

type Point = { x: number; y: number; strength: number };
function Lights({ points, index, activity, color, sparkleVariant }: {
  points: Point[]; index: number; activity: Activity; color: string; sparkleVariant?: number;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: activity.visibility.value * (sparkleVariant === undefined
      ? (activity.reducedMotion ? 0.27 :
        0.045 + activityWave(activity.phase.value, index / (GROUPS - 1)) * 0.6)
      : (activity.reducedMotion ? 0 :
        activitySparkle(activity.phase.value, index / (GROUPS - 1), sparkleVariant) * 0.9)),
  }));
  return <Animated.View style={[StyleSheet.absoluteFill, style]}>
    {points.map(({ x, y, strength }) => <View key={`${x}:${y}`} style={{
      position: "absolute", left: x - 3.5, top: y - 3.5,
      width: 7, height: 7, borderRadius: 2,
      backgroundColor: color, opacity: strength,
    }} />)}
  </Animated.View>;
}

/** Decorative working state. The session remains the sole owner of busy. */
export function SessionActivityField({ activity, textBounds, cornerRadius, horizontalOutset = 0 }: {
  activity: Activity; textBounds?: LayoutRectangle; cornerRadius: number; horizontalOutset?: number;
}) {
  const { isDark } = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const groups = useMemo(() => {
    const result: Point[][] = Array.from({ length: GROUPS }, () => []);
    const sparks: Point[][] = Array.from({ length: GROUPS * 3 }, () => []);
    for (let y = 5; y < size.height; y += SPACING) {
      for (let x = 5; x < size.width; x += SPACING) {
        const edge = Math.min(1, x / 70, (size.width - x) / 70, (size.height - y) / 15);
        const lower = Math.pow(y / size.height, 3);
        let textDim = 1;
        if (textBounds) {
          const dx = Math.max(textBounds.x + horizontalOutset - x, 0,
            x - textBounds.x - horizontalOutset - textBounds.width);
          const dy = Math.max(textBounds.y - y, 0, y - textBounds.y - textBounds.height);
          textDim = 0.12 + 0.88 * Math.min(1, Math.hypot(dx, dy) / 16);
        }
        const strength = edge * lower * textDim;
        const group = Math.round(x / size.width * (GROUPS - 1));
        const point = { x, y, strength };
        result[group].push(point);
        // Stable sparse accents: different rows twinkle in sequence, never at random.
        const cell = Math.imul(Math.round(x / SPACING) + 1, 73856093) ^
          Math.imul(Math.round(y / SPACING) + 1, 19349663);
        if ((cell >>> 0) % 4 === 0) sparks[group * 3 + ((cell >>> 3) % 3)].push(point);
      }
    }
    return { base: result, sparks };
  }, [size, textBounds, horizontalOutset]);
  if (!activity.present) return null;
  return <View pointerEvents="none" accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    onLayout={({ nativeEvent: { layout } }) => setSize((old) =>
      old.width === layout.width && old.height === layout.height ? old :
        { width: layout.width, height: layout.height })}
    style={[StyleSheet.absoluteFill, {
      left: -horizontalOutset, right: -horizontalOutset,
      borderRadius: cornerRadius, overflow: "hidden",
    }]}>
    {groups.base.map((points, index) => <Lights key={index} points={points}
      index={index} activity={activity} color={isDark ? "#a7bacb" : "#52677e"} />)}
    {!activity.reducedMotion && groups.sparks.map((points, index) => points.length > 0 ?
      <Lights key={`spark-${index}`} points={points} index={Math.floor(index / 3)}
        sparkleVariant={index % 3} activity={activity} color={isDark ? "#e1eaf2" : "#344d68"} /> : null)}
  </View>;
}
