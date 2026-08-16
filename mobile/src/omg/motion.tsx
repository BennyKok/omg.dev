/**
 * Motion primitives for the pressables and session list.
 *
 * Reanimated 4.5 has been in package.json — and in the shipped binary — since
 * the start (see app/session/[id].tsx's keyboard tracking) but nothing in the
 * app ever animated: zero `entering`/`exiting`/`layout` usage anywhere, and
 * every Pressable used the legacy opacity-only `pressed ? 0.5 : 1` pattern.
 * That reads as unfinished. This file is the fix, built entirely on the
 * duration/easing scale palette.ts already mirrors from the web's index.css
 * (`motion.micro/quick/fast/medium/slow`, `easeSmoothOut`, `easeBounce`) —
 * no new numbers invented here, and no new dependency: Reanimated alone
 * covers both the press spring and the list's layout animations.
 *
 * Reduce Motion handling is split across two mechanisms on purpose:
 *
 * - `FadeInDown`/`FadeOut`/`LinearTransition` (the list) default to
 *   `ReduceMotion.System`, which reads Reanimated's `ReducedMotionManager` —
 *   a value latched once from the native side at JS-bundle init and never
 *   updated again for the life of the app (see ReducedMotionManager in
 *   react-native-reanimated: `setEnabled` exists but nothing calls it on an
 *   OS toggle). Fine for "was Reduce Motion on when the app launched," wrong
 *   for "the user just flipped it in Settings and background-switched back."
 * - The press spring below runs on a raw shared value, not a
 *   BaseAnimationBuilder, so it never gets the `ReduceMotion.System` default
 *   at all — it has to be gated by hand.
 *
 * Both cases are fixed the same way: `useReduceMotionEnabled` combines
 * Reanimated's `useReducedMotion()` (a same-tick initial read) with RN's
 * `AccessibilityInfo.isReduceMotionEnabled()` + the `reduceMotionChanged`
 * event, so a live toggle actually reaches both the list transitions (via an
 * explicit `.reduceMotion(Always/Never)` override, recomputed on change) and
 * the press spring (which checks the flag directly). Reduce Motion is an
 * accessibility requirement, not a nicety: the state change — dim, then
 * settle — still has to reach someone who has it on, just without the
 * transform.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Reanimated, {
  Easing,
  FadeInDown,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { motion } from "./palette";

/**
 * CSS `cubic-bezier()` and Reanimated's `Easing.bezier()` take the same four
 * control points, so the mirrored palette values plug straight in.
 */
const easeSmoothOut = Easing.bezier(...motion.easeSmoothOut);

/**
 * Tuned to read as a physical button compressing, not a rubber band:
 * `dampingRatio` just under 1 settles with a hint of give rather than the
 * dead stop of critical damping, and stays well clear of the overshoot the
 * brief warns reads as cheaper than no animation. `withSpring` is naturally
 * interruptible — a new call re-solves from the in-flight value and
 * velocity, so a fast re-press never stutters or restarts.
 */
const pressSpring = { duration: 220, dampingRatio: 0.9 };

/**
 * Live Reduce Motion, unlike Reanimated's own `useReducedMotion()` (see file
 * header). Initial value comes from Reanimated's hook so the very first frame
 * is already correct instead of assuming motion is on; `AccessibilityInfo`
 * then keeps it live for the rest of the component's life.
 */
function useReduceMotionEnabled(): boolean {
  const initial = useReducedMotion();
  const [enabled, setEnabled] = useState(initial);
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!cancelled) setEnabled(value);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setEnabled);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
  return enabled;
}

/**
 * The compress-and-release feedback: a single 0→1 shared value drives both
 * scale and a slight opacity dim, so a caller that wants only one just passes
 * `scale: 1` or `dim: 1` for the other. Under Reduce Motion the value still
 * moves — instantly, no spring — so the opacity dim (a cross-fade, the HIG's
 * own suggested Reduce-Motion-safe substitute for a transform) still reaches
 * someone who has the setting on; only the scale term is neutralized to 1.
 */
export function usePressFeedback({
  scale = 1,
  dim = 1,
}: { scale?: number; dim?: number } = {}) {
  const reducedMotion = useReduceMotionEnabled();
  const progress = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - progress.value * (1 - (reducedMotion ? 1 : scale)) }],
    opacity: 1 - progress.value * (1 - dim),
  }));
  const onPressIn = useCallback(() => {
    progress.value = reducedMotion ? 1 : withSpring(1, pressSpring);
  }, [progress, reducedMotion]);
  const onPressOut = useCallback(() => {
    progress.value = reducedMotion ? 0 : withSpring(0, pressSpring);
  }, [progress, reducedMotion]);
  return { style, onPressIn, onPressOut };
}

type PressableScaleProps = Omit<PressableProps, "style" | "children"> & {
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
  children?: React.ReactNode | ((state: PressableStateCallbackType) => React.ReactNode);
  /** Resting→pressed scale factor. 1 (default) disables the scale term. */
  scale?: number;
  /** Resting→pressed opacity factor. 1 (default) disables the dim term. */
  dim?: number;
};

/**
 * Drop-in `Pressable` replacement that compresses under the thumb.
 *
 * The scale/opacity lives on an inner `Reanimated.View`, not on the
 * `Pressable` itself: mixing a Reanimated `useAnimatedStyle` result into
 * `Pressable`'s own pressed-state style *function* would require Reanimated
 * to see the animated-style marker at the point it inspects `style`, which a
 * caller-supplied function hides until Pressable itself invokes it. Keeping
 * `Pressable` a plain, unwrapped component preserves the existing
 * `style={(state) => ...}` / function-children API untouched — every current
 * call site's pressed-conditional background/border logic keeps working
 * exactly as written — while the inner view adds only the new motion.
 */
export function PressableScale({
  style,
  children,
  scale = 1,
  dim = 1,
  onPressIn,
  onPressOut,
  ...pressableProps
}: PressableScaleProps) {
  const feedback = usePressFeedback({ scale, dim });
  return (
    <Pressable
      {...pressableProps}
      onPressIn={(event) => {
        feedback.onPressIn();
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        feedback.onPressOut();
        onPressOut?.(event);
      }}
    >
      {(state) => (
        <Reanimated.View
          style={[typeof style === "function" ? style(state) : style, feedback.style]}
        >
          {typeof children === "function" ? children(state) : children}
        </Reanimated.View>
      )}
    </Pressable>
  );
}

/**
 * Entering/reflow for the session list — a card sliding in from a
 * `POST /api/sessions/new`, and the rest resettling around it. `app/index.tsx`
 * owns the list; this lives here because `SessionCard` needs the identical
 * config for its own mount.
 *
 * Each builder gets an explicit `.reduceMotion()` recomputed from the live
 * flag rather than relying on the `ReduceMotion.System` default, for the same
 * reason `usePressFeedback` doesn't either — see the file header.
 *
 * THERE IS DELIBERATELY NO `exiting` HERE. DO NOT ADD ONE.
 *
 * This was `FadeOut.duration(motion.fast)`, and it is what produced the
 * long-standing "the session list renders twice, offset, with a second list's
 * rows peeking through the gaps" report.
 *
 * An exiting animation is the only one of the three that keeps a view alive
 * AFTER React has unmounted it: Reanimated pulls it out of the layout flow,
 * holds it at an absolute frame, and drops it when the animation ends. If a
 * re-render lands inside that 250ms window the animation is interrupted, and
 * nothing owns the view any more — React is done with it and Reanimated has
 * stopped animating it — so it is stranded on screen at the coordinates it
 * had when it left. The rows still in flow then reflow past it (the list
 * polls every 10s and sections resize constantly), and the stranded frame is
 * left painting over whatever now occupies that space. Ghosts of the Recent
 * section on top of the live Idle rows is exactly what that looks like.
 *
 * Reproduced on the simulator by dropping and restoring the Recent rows every
 * 120ms — inside `motion.fast` — which piled up stranded cards under a
 * section header that had already gone; removing `exiting` made the same
 * probe completely clean. `entering` and `layout` were hammered by that same
 * probe and stranded nothing, because both END with the view in its correct
 * flow position, so an interruption is self-correcting. An interrupted exit
 * is not, and no amount of care at the call site can make it so.
 *
 * The cost is small and mostly theoretical: the one row-removal a person
 * actually initiates is swipe-to-archive, and that already animates itself
 * off-screen on its own `translateX` before the data drops it (see
 * SessionCard) — it never depended on this.
 */
export function useListItemMotion() {
  const reducedMotion = useReduceMotionEnabled();
  return useMemo(() => {
    const mode = reducedMotion ? ReduceMotion.Always : ReduceMotion.Never;
    return {
      entering: FadeInDown.duration(motion.medium)
        .easing(easeSmoothOut)
        .withInitialValues({ translateY: 8 })
        .reduceMotion(mode),
      layout: LinearTransition.duration(motion.medium).easing(easeSmoothOut).reduceMotion(mode),
    };
  }, [reducedMotion]);
}
