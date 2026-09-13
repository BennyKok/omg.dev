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
  useSyncExternalStore,
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
  withSpring,
  cancelAnimation,
} from "react-native-reanimated";

import { Icon } from "../components";
import { Text } from "./text";
import { useTheme } from "./theme";

import { createToastController, TOAST_STATUS, type ToastOptions, type ToastState, type ToastFeedback } from "./toast-state";
export { plainMessage } from "./toast-state";
export type { ToastIntent, ToastOptions } from "./toast-state";
export type ToastHandle = {
  show: (message: string, options: ToastOptions) => number | undefined;
  dismiss: (id?: number) => void;
};
const TRAVEL = 18;
const SWIPE_DISMISS_PX = 32;
const SWIPE_DISMISS_VELOCITY = 0.5;
const SPRING = { damping: 26, stiffness: 300, mass: 0.8, overshootClamping: true };
function feedback(kind: ToastFeedback) {
  const result = kind === "light"
    ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    : kind === "none" ? undefined : Haptics.notificationAsync(kind === "warning"
      ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error);
  void result?.catch(() => {});
}

const ToastContext = createContext<ToastHandle | null>(null);

export function useToast(): ToastHandle {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider");
  return value;
}

export function ToastProvider({ children }: PropsWithChildren) {
  const [controller] = useState(() => createToastController(feedback));
  const toast = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useEffect(() => () => controller.reset(), [controller]);
  const value = useMemo<ToastHandle>(() => ({ show: controller.show, dismiss: controller.dismiss }), [controller]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastHost toast={toast} onDismiss={controller.dismiss} onPause={controller.pause} onResume={controller.resume} />
    </ToastContext.Provider>
  );
}

function ToastHost({ toast, onDismiss, onPause, onResume }: { toast: ToastState | null; onDismiss: (id?: number) => void; onPause: (id: number) => void; onResume: (id?: number) => void }) {
  const insets = useSafeAreaInsets();
  const { colors, space, radius, type: typeScale } = useTheme();
  const reducedMotion = useReducedMotion();

  // The provider clears `toast` the instant a dismiss is decided so its timer
  // logic stays simple; this keeps rendering the last content itself while the
  // exit animation plays, then drops it.
  const [rendered, setRendered] = useState<ToastState | null>(null);
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(-TRAVEL);

  const scale = useSharedValue(0.98);
  const activeId = useRef<number | null>(null);
  const renderedRef = useRef<ToastState | null>(null);
  const drop = useCallback((id: number) => {
    if (activeId.current !== null) return;
    setRendered(current => current?.id === id ? null : current);
    if (renderedRef.current?.id === id) renderedRef.current = null;
  }, []);
  useEffect(() => {
    const easing = Easing.out(Easing.cubic);
    cancelAnimation(opacity); cancelAnimation(translateY); cancelAnimation(scale);
    activeId.current = toast?.id ?? null;
    if (toast) {
      const entering = !renderedRef.current;
      renderedRef.current = toast;
      setRendered(toast);
      if (entering) {
        opacity.value = 0;
        translateY.value = reducedMotion ? 0 : -TRAVEL;
        scale.value = reducedMotion ? 1 : 0.98;
      }
      opacity.value = withTiming(1, { duration: 180, easing });
      translateY.value = reducedMotion ? 0 : withSpring(0, SPRING);
      scale.value = reducedMotion ? 1 : withSpring(1, SPRING);
    } else if (renderedRef.current) {
      const id = renderedRef.current.id;
      opacity.value = withTiming(0, { duration: 160, easing }, finished => {
        if (finished) runOnJS(drop)(id);
      });
      translateY.value = reducedMotion ? 0 : withTiming(-TRAVEL, { duration: 160, easing });
      scale.value = reducedMotion ? 1 : withTiming(0.98, { duration: 160, easing });
    }
    return () => { cancelAnimation(opacity); cancelAnimation(translateY); cancelAnimation(scale); };
  }, [toast, reducedMotion, drop, opacity, translateY, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));
  const gestureId = useRef<number | null>(null);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          gesture.dy < -6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
          gestureId.current = activeId.current;
          if (gestureId.current !== null) onPause(gestureId.current);
          cancelAnimation(translateY);
        },
        onPanResponderMove: (_evt, gesture) => {
          if (!reducedMotion && gestureId.current === activeId.current && gesture.dy < 0) translateY.value = Math.max(-100, gesture.dy);
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (gestureId.current !== activeId.current || gestureId.current === null) return;
          if (gesture.dy < -SWIPE_DISMISS_PX || gesture.vy < -SWIPE_DISMISS_VELOCITY) {
            onDismiss(gestureId.current);
          } else {
            translateY.value = reducedMotion ? 0 : withSpring(0, SPRING);
            if (gestureId.current !== null) onResume(gestureId.current);
          }
        },
        onPanResponderTerminate: () => {
          translateY.value = reducedMotion ? 0 : withSpring(0, SPRING);
          if (gestureId.current !== null) onResume(gestureId.current);
        },
      }),
    [onDismiss, onPause, onResume, reducedMotion, translateY],
  );

  if (!rendered) return null;

  const status = TOAST_STATUS[rendered.intent];
  const tint = rendered.intent === "info" ? colors.textSecondary
    : rendered.intent === "success" ? colors.success
    : rendered.intent === "warning" ? colors.warning : colors.danger;

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
          onPress={() => onDismiss(rendered.id)}
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
            borderColor: colors.border,
            shadowColor: "#000",
            shadowOpacity: 0.16,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 6,
          }}
        >
          <Icon
            ios={status.ios}
            android={status.android}
            size={18}
            color={tint}
          />
          <Text style={{ ...typeScale.footnote, color: colors.text, flex: 1 }} numberOfLines={4}>
            {rendered.message}
          </Text>
        </Pressable>
      </Reanimated.View>
    </View>
  );
}
