/**
 * Skeleton loading primitives: a UI-thread shimmer, and a bone shaped like
 * `SessionCard` in ../components.tsx.
 *
 * The animation runs entirely on the UI thread (reanimated shared values +
 * worklets) rather than driving opacity from JS-thread state. A JS-thread
 * shimmer competes with the network response and the list re-render it is
 * meant to be covering — the one moment it is guaranteed to stutter is
 * exactly the moment it exists to paper over.
 *
 * `useReducedMotion` is a startup snapshot, not reactive (reanimated does not
 * re-render on a live toggle of the OS setting) — acceptable here since a
 * skeleton's lifetime is a single loading window, never long enough to see
 * the setting change mid-render.
 */

import { useEffect } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Reanimated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme } from "./theme";
import { SESSION_ROW } from "../components";

/** One full sweep, edge to edge. Slower than any UI transition on purpose —
 * this loops for as long as the request is in flight, not for a fixed beat. */
const SHIMMER_DURATION_MS = 1100;

/**
 * Drives one shimmer sweep. Shared by every bone in a skeleton tree so they
 * move in lockstep rather than N independent, visibly-out-of-phase loops.
 */
export function useShimmer() {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) return;
    progress.value = withRepeat(
      withTiming(1, { duration: SHIMMER_DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [reducedMotion, progress]);

  return { progress, reducedMotion };
}

/**
 * One placeholder shape. `width` is a real number, not a percentage: the
 * sweep is a gradient translated by `width`, so it has to know the pixel span
 * it is covering rather than discovering it from layout.
 */
export function Bone({
  width,
  height,
  radius = 6,
  progress,
  reducedMotion,
  style,
}: {
  width: number;
  height: number;
  radius?: number;
  progress: SharedValue<number>;
  reducedMotion: boolean;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [-width, width]) }],
  }));

  return (
    <View
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.secondary, overflow: "hidden" },
        style,
      ]}
    >
      {reducedMotion ? null : (
        <Reanimated.View style={[StyleSheet.absoluteFill, sweepStyle]}>
          <LinearGradient
            colors={["transparent", colors.borderStrong, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ width: width * 2, height: "100%" }}
          />
        </Reanimated.View>
      )}
    </View>
  );
}

/** Loading rows use the same geometry as the live session rows. */
const CARD = {
  titleHeight: 17,
  titleWidth: 148,
  subtitleHeight: 15,
  subtitleWidth: 104,
  dot: 10,
};

/** Same shape as SessionCard, mid-shimmer instead of mid-render. */
export function SessionCardSkeleton({
  progress,
  reducedMotion,
}: {
  progress: SharedValue<number>;
  reducedMotion: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SESSION_ROW.gap,
        marginHorizontal: SESSION_ROW.inset,
        paddingLeft: SESSION_ROW.padding,
        paddingRight: SESSION_ROW.paddingRight,
        height: SESSION_ROW.height,
      }}
    >
      <Bone
        width={SESSION_ROW.avatar}
        height={SESSION_ROW.avatar}
        radius={SESSION_ROW.avatar / 2}
        progress={progress}
        reducedMotion={reducedMotion}
      />
      <View style={{ flex: 1, gap: SESSION_ROW.textGap, minWidth: 0 }}>
        <Bone
          width={CARD.titleWidth}
          height={CARD.titleHeight}
          radius={4}
          progress={progress}
          reducedMotion={reducedMotion}
        />
        <Bone
          width={CARD.subtitleWidth}
          height={CARD.subtitleHeight}
          radius={4}
          progress={progress}
          reducedMotion={reducedMotion}
        />
      </View>
      <View style={{ width: CARD.dot, height: CARD.dot, borderRadius: CARD.dot / 2, backgroundColor: colors.secondary }} />
    </View>
  );
}

/** Session placeholders share one shimmer and the real row height. */
export function SessionListSkeleton({ count = 3, style }: { count?: number; style?: ViewStyle }) {
  const { progress, reducedMotion } = useShimmer();
  return (
    // No extra gap between rows.
    <View style={style}>
      {Array.from({ length: count }, (_, i) => (
        <SessionCardSkeleton
          key={i}
          progress={progress}
          reducedMotion={reducedMotion}
        />
      ))}
    </View>
  );
}
