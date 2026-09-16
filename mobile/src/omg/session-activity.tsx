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
        phase.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.linear }), -1, false);
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
  const distance = Math.abs(position - (phase * 1.6 - 0.3));
  return distance >= 0.3 ? 0 : (1 + Math.cos(distance / 0.3 * Math.PI)) / 2;
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
function Lights({ points, index, activity, color }: {
  points: Point[]; index: number; activity: Activity; color: string;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: activity.visibility.value * (activity.reducedMotion ? 0.22 :
      0.035 + activityWave(activity.phase.value, index / (GROUPS - 1)) * 0.45),
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
        result[group].push({ x, y, strength });
      }
    }
    return result;
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
    {groups.map((points, index) => <Lights key={index} points={points}
      index={index} activity={activity} color={isDark ? "#a7bacb" : "#52677e"} />)}
  </View>;
}
