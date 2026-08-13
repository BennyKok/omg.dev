/**
 * A transient banner for error/success feedback — the native counterpart to the
 * web dashboard's sonner Toaster, which already renders `top-center` on mobile
 * (web/src/App.tsx) precisely because a bottom-anchored stack there fights the
 * composer. Five screens here used to drop a red `<Text>` straight into their
 * layout for this: no dismiss, no timeout, and everything below it jumped when
 * it appeared or cleared. This overlays instead, so the layout under it never
 * moves.
 *
 * Placement is top, not bottom, on purpose: both screens with a composer
 * (index.tsx, session/[id].tsx) pin it to the bottom, so anything anchored
 * there would sit on top of the one control a person is mid-typing into. The
 * top is otherwise just the brand mark / machine chip or a translucent native
 * header — floating a banner over that for two or three seconds is the same
 * trade the web already made.
 *
 * One toast at a time, replacing rather than queuing: a phone screen has no
 * room to stack banners without either shrinking each one unreadably or
 * pushing the second into the header, and a newer message is by definition
 * more current than whatever it replaces. `show()` cancels any pending
 * auto-dismiss timer and swaps content immediately.
 *
 * Swipe-to-dismiss is built on `PanResponder` (react-native core) rather than
 * react-native-gesture-handler — GH resolves in node_modules as a transitive
 * dependency of expo-router/react-native-screens, but it is not on the
 * explicit OTA-safe list for this bundle and using its components requires a
 * `GestureHandlerRootView` this app does not currently mount. PanResponder
 * needs neither, and driving a Reanimated shared value from its callbacks is
 * enough for a banner that only ever has one gesture on screen.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { PanResponder, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { Icon } from "../components";
import { Text } from "./text";
import { useTheme } from "./theme";

export type ToastIntent = "error" | "success";

export type ToastOptions = {
  intent?: ToastIntent;
  /** Overrides the length-scaled auto duration, in ms. */
  duration?: number;
};

export type ToastHandle = {
  show: (message: string, options?: ToastOptions) => void;
  dismiss: () => void;
};

type ToastState = { id: number; message: string; intent: ToastIntent; duration: number };

/** How far the banner travels on enter/exit. Skipped under reduced motion. */
const TRAVEL = 24;
/** Upward drag past this, or a fast enough flick, dismisses. */
const SWIPE_DISMISS_PX = 32;
const SWIPE_DISMISS_VELOCITY = 0.5;

/**
 * Reading pace, not message importance, drives the timer: a two-word
 * confirmation needs less time on screen than a sentence someone has to
 * actually read. ~3 words/sec plus a floor so even "Saved." doesn't vanish
 * before an eye lands on it, capped so a long error can't pin the banner up
 * indefinitely.
 */
function autoDuration(message: string): number {
  const words = message.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(7000, Math.max(2200, 900 + words * 350));
}

const ToastContext = createContext<ToastHandle | null>(null);

export function useToast(): ToastHandle {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setToast(null);
  }, [clearTimer]);

  const show = useCallback(
    (message: string, options?: ToastOptions) => {
      clearTimer();
      const id = ++idRef.current;
      const duration = options?.duration ?? autoDuration(message);
      const intent = options?.intent ?? "error";
      void Haptics.notificationAsync(
        intent === "success"
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Error,
      );
      setToast({ id, message, intent, duration });
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setToast((current) => (current?.id === id ? null : current));
      }, duration);
    },
    [clearTimer],
  );

  // A dismiss (tap, swipe, or the timer) must not fire against a screen the
  // provider has already unmounted from.
  useEffect(() => clearTimer, [clearTimer]);

  const value = useMemo<ToastHandle>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost toast={toast} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastHost({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  const { colors, space, radius, type: typeScale, motion } = useTheme();
  const reducedMotion = useReducedMotion();

  // The provider clears `toast` the instant a dismiss is decided so its timer
  // logic stays simple; this keeps rendering the last content itself while the
  // exit animation plays, then drops it.
  const [rendered, setRendered] = useState<ToastState | null>(null);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-TRAVEL);

  useEffect(() => {
    const easing = Easing.bezier(...motion.easeSmoothOut);
    if (toast) {
      setRendered(toast);
      opacity.value = 0;
      translateY.value = reducedMotion ? 0 : -TRAVEL;
      opacity.value = withTiming(1, { duration: motion.fast, easing });
      if (!reducedMotion) translateY.value = withTiming(0, { duration: motion.fast, easing });
    } else if (rendered) {
      opacity.value = withTiming(0, { duration: motion.quick, easing }, (finished) => {
        if (finished) runOnJS(setRendered)(null);
      });
      if (!reducedMotion) translateY.value = withTiming(-TRAVEL, { duration: motion.quick, easing });
    }
    // rendered is read, not depended on: re-running this when it changes would
    // re-trigger the exit animation it itself schedules.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          gesture.dy < -6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_evt, gesture) => {
          if (gesture.dy < 0) translateY.value = gesture.dy;
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (gesture.dy < -SWIPE_DISMISS_PX || gesture.vy < -SWIPE_DISMISS_VELOCITY) {
            onDismiss();
          } else {
            translateY.value = withTiming(0, { duration: motion.quick });
          }
        },
        onPanResponderTerminate: () => {
          translateY.value = withTiming(0, { duration: motion.quick });
        },
      }),
    [onDismiss, motion.quick, translateY],
  );

  if (!rendered) return null;

  const tint = rendered.intent === "success" ? colors.success : colors.danger;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Reanimated.View
        {...panResponder.panHandlers}
        style={[
          animatedStyle,
          {
            position: "absolute",
            top: insets.top + space.sm,
            left: space.lg,
            right: space.lg,
            alignItems: "center",
          },
        ]}
      >
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={rendered.message}
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            maxWidth: 480,
            width: "100%",
            paddingHorizontal: space.md,
            paddingVertical: space.sm + 2,
            borderRadius: radius.lg,
            backgroundColor: colors.popover,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: `${tint}4D`,
            shadowColor: colors.text,
            shadowOpacity: 0.16,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <Icon
            ios={rendered.intent === "success" ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"}
            android={rendered.intent === "success" ? "check_circle" : "warning"}
            size={18}
            color={tint}
          />
          <Text style={{ ...typeScale.footnote, color: tint, flex: 1 }} numberOfLines={4}>
            {rendered.message}
          </Text>
        </Pressable>
      </Reanimated.View>
    </View>
  );
}
