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

/**
 * Geometry mirrored by hand from SessionCard in ../components.tsx (avatar
 * size, padding, gap, corner radius) rather than imported, because this file
 * does not own that component and a shared-token refactor is out of scope
 * here. If these ever drift apart the list will visibly jump when real data
 * lands — worth promoting avatar/padding/radius to shared tokens if another
 * skeleton needs the same shape.
 */
const CARD = {
  padding: 16, // space.lg
  gap: 12, // space.md
  avatar: 40, // AgentAvatar default size
  radius: 18, // radius.xl
  dot: 10,
  titleHeight: 17, // type.headline fontSize
  titleWidth: 148,
  subtitleHeight: 13, // type.footnote fontSize
  subtitleWidth: 104,
};

/** Same shape as SessionCard, mid-shimmer instead of mid-render. */
export function SessionCardSkeleton({
  progress,
  reducedMotion,
}: {
  progress: SharedValue<number>;
  reducedMotion: boolean;
}) {
  const { colors, isDark, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: CARD.gap,
        backgroundColor: colors.card,
        borderRadius: CARD.radius,
        marginHorizontal: space.lg,
        padding: CARD.padding,
        borderWidth: isDark ? StyleSheet.hairlineWidth : 0,
        borderColor: colors.borderSoft,
      }}
    >
      <Bone
        width={CARD.avatar}
        height={CARD.avatar}
        radius={CARD.avatar / 2}
        progress={progress}
        reducedMotion={reducedMotion}
      />
      <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
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

/**
 * A stack of session-card bones, gapped the same as the real list
 * (`space.md` in app/index.tsx). One shared shimmer drives all of them.
 */
export function SessionListSkeleton({ count = 3, style }: { count?: number; style?: ViewStyle }) {
  const { space } = useTheme();
  const { progress, reducedMotion } = useShimmer();
  return (
    <View style={[{ gap: space.md }, style]}>
      {Array.from({ length: count }, (_, i) => (
        <SessionCardSkeleton key={i} progress={progress} reducedMotion={reducedMotion} />
      ))}
    </View>
  );
}
