import { useEffect, useMemo, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  cancelAnimation, Easing, type SharedValue, useAnimatedStyle,
  useSharedValue, withRepeat, withTiming,
} from "react-native-reanimated";
import { useReduceMotionEnabled } from "./motion";
import { useTheme } from "./theme";

const SPACING = 10;
const GROUPS = 8;

function hash(value: string): number {
  let result = 5381;
  for (let i = 0; i < value.length; i++) result = (result * 33 ^ value.charCodeAt(i)) >>> 0;
  return result;
}

type Point = { x: number; y: number; strength: number };

/** A handful of opacity layers, rather than one worklet per grid point. */
function Lights({ points, index, phase, color }: {
  points: Point[]; index: number; phase: SharedValue<number>; color: string;
}) {
  const style = useAnimatedStyle(() => {
    const wave = (1 + Math.sin(phase.value * Math.PI * 2 + index * 2.39996)) / 2;
    // Long, smooth rests between blooms. No blinking, translation or scaling.
    return { opacity: 0.07 + Math.pow(wave, 5) * 0.55 };
  });
  return <Animated.View style={[StyleSheet.absoluteFill, style]}>
    {points.map(({ x, y, strength }) => <View key={`${x}:${y}`} style={{
      position: "absolute", left: x - 2.5, top: y - 2.5,
      width: 5, height: 5, borderRadius: 1.25,
      backgroundColor: color, opacity: strength,
    }} />)}
  </Animated.View>;
}

/** Decorative working state. The session remains the sole owner of busy. */
export function SessionActivityField({ identity, cornerRadius, horizontalOutset = 0 }: {
  identity: string; cornerRadius: number; horizontalOutset?: number;
}) {
  const { isDark } = useTheme();
  const reducedMotion = useReduceMotionEnabled();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const seed = useMemo(() => hash(identity), [identity]);
  const phase = useSharedValue(0);
  const offset = (seed % 997) / 997;

  useEffect(() => {
    const update = () => {
      cancelAnimation(phase);
      phase.value = offset;
      if (!reducedMotion && AppState.currentState === "active") {
        phase.value = withRepeat(withTiming(offset + 1, {
          duration: 7600 + seed % 2400, easing: Easing.linear,
        }), -1, false);
      }
    };
    update();
    const subscription = AppState.addEventListener("change", update);
    return () => { subscription.remove(); cancelAnimation(phase); };
  }, [offset, phase, reducedMotion, seed]);

  const groups = useMemo(() => {
    const result: Point[][] = Array.from({ length: GROUPS }, () => []);
    // Fixed point spacing keeps cells square at every row width and height.
    for (let y = 5; y < size.height; y += SPACING) {
      for (let x = 5; x < size.width; x += SPACING) {
        const noise = hash(`${seed}:${x}:${y}`);
        const edge = Math.min(1, x / 32, (size.width - x) / 32,
          y / 16, (size.height - y) / 16);
        // Leave the logo and the two text baselines visually quiet. The light
        // gathers in the row's lower margin, like the reference's underglow.
        const lower = Math.pow(y / size.height, 2);
        const strength = edge * (0.12 + lower * 0.65) * (0.35 + noise % 100 / 100 * 0.65);
        result[noise % GROUPS].push({ x, y, strength });
      }
    }
    return result;
  }, [seed, size]);

  const breath = useAnimatedStyle(() => ({
    opacity: 0.45 + (1 + Math.sin(phase.value * Math.PI * 2)) * 0.2,
  }));

  return <View pointerEvents="none" accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    onLayout={({ nativeEvent: { layout } }) => setSize((old) =>
      old.width === layout.width && old.height === layout.height ? old :
        { width: layout.width, height: layout.height })}
    style={[StyleSheet.absoluteFill, {
      left: -horizontalOutset, right: -horizontalOutset,
      borderRadius: cornerRadius, overflow: "hidden",
    }]}>
    <Animated.View style={[StyleSheet.absoluteFill, breath]}>
      <LinearGradient
        colors={isDark ? ["#8daec900", "#8daec907", "#8daec90c", "#8daec907", "#8daec900"]
          : ["#52677e00", "#52677e03", "#52677e06", "#52677e03", "#52677e00"]}
        start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
        locations={[0, 0.12, 0.5, 0.88, 1]} style={StyleSheet.absoluteFill} />
    </Animated.View>
    {groups.map((points, index) => <Lights key={index} points={points}
      index={index} phase={phase} color={isDark ? "#a7bacb" : "#52677e"} />)}
  </View>;
}
