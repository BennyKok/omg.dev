import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, StyleSheet, View, type LayoutRectangle, type TextStyle } from "react-native";
import Animated, {
  cancelAnimation, Easing, runOnJS, type SharedValue, useAnimatedStyle,
  useSharedValue, withRepeat, withTiming,
} from "react-native-reanimated";
import { Text } from "./text";
import { useReduceMotionEnabled } from "./motion";
import { useTheme } from "./theme";
import { ActivityCanvas, activityCanvasSupported } from "./session-activity-canvas";

const SPACING = 10;
const GROUPS = 24;
const AnimatedText = Animated.createAnimatedComponent(Text);

type Activity = {
  phase: SharedValue<number>;
  visibility: SharedValue<number>;
  present: boolean;
  reducedMotion: boolean;
};

/**
 * Is the surface that holds these rows actually on screen?
 *
 * ── Why a context and not just `busy` ─────────────────────────────────────
 *
 * The clock below is a Reanimated animation, so it lives on the UI thread and
 * it does not care that a pushed screen is drawn on top of Home. Expo Router's
 * native stack keeps Home MOUNTED underneath `/session/[id]`, so every working
 * row kept re-evaluating roughly a hundred animated styles per frame while the
 * user was reading a transcript that could see none of them. With a fleet of
 * agents running that is the single largest cost in the app, spent entirely on
 * pixels behind another screen.
 *
 * Freezing the React subtree does not help: `freezeOnBlur` stops renders, and
 * these worklets are not renders. The clock has to be stopped by name.
 *
 * Default true, so a row outside any pane (the chat header, the archive list)
 * behaves exactly as before.
 */
const ActivityPane = createContext(true);

/** Wrap the rows a screen owns, and say when that screen is visible. */
export function SessionActivityPane({ onScreen, children }: { onScreen: boolean; children: ReactNode }) {
  return <ActivityPane.Provider value={onScreen}>{children}</ActivityPane.Provider>;
}

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
  const onScreen = useContext(ActivityPane);
  // Present but covered keeps the field MOUNTED and simply stops its clock, so
  // coming back is a resumed animation rather than a re-entrance the user
  // watches play out under their thumb.
  const running = present && onScreen;
  useEffect(() => {
    const update = () => {
      cancelAnimation(phase);
      phase.value = 0;
      if (running && !reducedMotion && AppState.currentState === "active") {
        // A long clock avoids repeating the noise every few wave passes.
        phase.value = withRepeat(withTiming(20480, { duration: 20480 * 2200, easing: Easing.linear }), -1, false);
      }
    };
    update();
    // A row with no clock to resume needs no listener. Every session row calls
    // this hook, idle ones included, so subscribing unconditionally put one
    // AppState listener per session on the bridge and woke all of them on
    // every foreground transition.
    if (!running) return () => cancelAnimation(phase);
    const subscription = AppState.addEventListener("change", update);
    return () => { subscription.remove(); cancelAnimation(phase); };
  }, [running, phase, reducedMotion]);
  return { phase, visibility, present, reducedMotion };
}

/** A broad highlight travels left to right, then clears the edge before looping. */
export function activityWave(phase: number, position: number): number {
  "worklet";
  const wavePhase = phase % 1;
  const distance = Math.abs(position - (wavePhase * 1.6 - 0.3));
  return distance >= 0.3 ? 0 : (1 + Math.cos(distance / 0.3 * Math.PI)) / 2;
}

/** Avalanche the bits so neighbouring cells do not form diagonal hash bands. */
function noiseHash(value: number): number {
  "worklet";
  let n = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

function identitySeed(identity: string): number {
  let seed = 5381;
  for (let i = 0; i < identity.length; i++) seed = Math.imul(seed, 33) ^ identity.charCodeAt(i);
  return seed;
}

/** Smooth value noise: new brightness targets every 2s, with no sharp peaks. */
export function activityBreath(phase: number, position: number, seed: number): number {
  "worklet";
  const time = phase * 2.2 / 2 + noiseHash(seed) * 2048;
  const cell = Math.floor(time);
  const fraction = time - cell;
  const blend = fraction * fraction * fraction * (fraction * (fraction * 6 - 15) + 10);
  const salt = seed ^ Math.round(position * 65536);
  // Period matches the long clock, including the interpolation across its seam.
  const from = noiseHash(salt ^ Math.imul(cell & 2047, 0x9e3779b1));
  const to = noiseHash(salt ^ Math.imul((cell + 1) & 2047, 0x9e3779b1));
  const noise = from + (to - from) * blend;
  return 0.04 + 0.96 * noise * noise;
}

export function activitySparkle(phase: number, position: number, seed: number): number {
  "worklet";
  const breath = activityBreath(phase, position, seed);
  return breath * 0.5 + breath * activityWave(phase, position) * 0.5;
}

/** One composited pulse preserves native shaping without per-letter updates. */
export function SessionActivityTitle({ title, activity, style }: {
  title: string; activity: Activity; style: TextStyle;
}) {
  // Updating the colour of each nested letter invalidates native text on every
  // frame. Opacity animates one text surface, independent of title length.
  const pulse = useAnimatedStyle(() => ({
    opacity: activity.reducedMotion ? 1 :
      1 - activity.visibility.value * 0.25 * (1 - activityWave(activity.phase.value, 0.5)),
  }));
  return <AnimatedText numberOfLines={1} accessibilityLabel={title} style={[style, pulse]}>
    {title}
  </AnimatedText>;
}

type Point = { x: number; y: number; strength: number; seed: number };
function Lights({ points, index, activity, color, sparkleSeed }: {
  points: Point[]; index: number; activity: Activity; color: string; sparkleSeed?: number;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: activity.visibility.value * (sparkleSeed === undefined
      ? (activity.reducedMotion ? 0.27 :
        0.045 + activityWave(activity.phase.value, index / (GROUPS - 1)) * 0.6)
      : (activity.reducedMotion ? 0 :
        activitySparkle(activity.phase.value, index / (GROUPS - 1), sparkleSeed) * 0.9)),
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
export function SessionActivityField({ activity, textBounds, cornerRadius, horizontalOutset = 0, identity = "session" }: {
  activity: Activity; textBounds?: LayoutRectangle; cornerRadius: number; horizontalOutset?: number; identity?: string;
}) {
  const { isDark } = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const baseColor = isDark ? "#a7bacb" : "#52677e";
  const sparkColor = isDark ? "#e1eaf2" : "#344d68";
  const groups = useMemo(() => {
    // The shader needs none of this. Building it anyway would keep the whole
    // cost this change exists to remove, for a result nothing reads.
    if (activityCanvasSupported) return { base: [] as Point[][], sparks: [] as { point: Point; group: number }[] };
    const result: Point[][] = Array.from({ length: GROUPS }, () => []);
    const sparks: { point: Point; group: number }[] = [];
    const rowSeed = identitySeed(identity);
    for (let y = 5; y < size.height; y += SPACING) {
      for (let x = 5; x < size.width; x += SPACING) {
        const edge = Math.min(1, x / 70, (size.width - x) / 70);
        const bottom = Math.min(1, Math.max(0, (size.height - y) / 24));
        const bottomFade = bottom * bottom * (3 - 2 * bottom);
        const lower = Math.pow(y / size.height, 3);
        let textDim = 1;
        if (textBounds) {
          const dx = Math.max(textBounds.x + horizontalOutset - x, 0,
            x - textBounds.x - horizontalOutset - textBounds.width);
          const dy = Math.max(textBounds.y - y, 0, y - textBounds.y - textBounds.height);
          textDim = 0.12 + 0.88 * Math.min(1, Math.hypot(dx, dy) / 16);
        }
        const strength = edge * bottomFade * lower * textDim;
        const group = Math.round(x / size.width * (GROUPS - 1));
        const cell = rowSeed ^ Math.imul(Math.round(x / SPACING) + 1, 73856093) ^
          Math.imul(Math.round(y / SPACING) + 1, 19349663);
        const point = { x, y, strength, seed: Math.floor(noiseHash(cell) * 4294967296) };
        result[group].push(point);
        if (noiseHash(point.seed ^ 0x68bc21eb) < 0.25) sparks.push({ point, group });
      }
    }
    return { base: result, sparks };
  }, [size, textBounds, horizontalOutset, identity]);
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
    {activityCanvasSupported
      ? (size.width > 0 && size.height > 0 ? <ActivityCanvas
          width={size.width} height={size.height} cornerRadius={cornerRadius}
          phase={activity.phase} visibility={activity.visibility}
          rowSeed={identitySeed(identity)} reducedMotion={activity.reducedMotion}
          // The field is drawn one outset wider than the row on each side, so
          // the measured column has to move with it.
          text={textBounds ? {
            x: textBounds.x + horizontalOutset, y: textBounds.y,
            width: textBounds.width, height: textBounds.height,
          } : undefined}
          baseColor={baseColor} sparkColor={sparkColor} /> : null)
      : <>
        {groups.base.map((points, index) => <Lights key={index} points={points}
          index={index} activity={activity} color={baseColor} />)}
        {!activity.reducedMotion && groups.sparks.map(({ point, group }) =>
          <Lights key={`spark-${point.x}:${point.y}`} points={[point]} index={group}
            sparkleSeed={point.seed} activity={activity} color={sparkColor} />)}
      </>}
  </View>;
}

/** Report the renderer selected by the field itself, including fallback. */
export const sessionActivityRenderer = activityCanvasSupported ? "shader" : "views";
