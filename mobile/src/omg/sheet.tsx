/**
 * THE ONE CARD. Every floating card in the app — the agent picker, the
 * shortcuts list, the folder rail arrangement, the create card — is this:
 * a dimmed backdrop that closes on tap, a glass card that eases in from
 * below, a grabber, and a drag-down to dismiss. Four copies of that
 * boilerplate had drifted in small ways; this is the only copy now.
 *
 * DRAG TO DISMISS lives on the grabber zone (the top ~40pt of the card,
 * full width), not on the whole card: the cards carry ScrollViews and a
 * whole-card pan would fight them. Pull the card down past a third of its
 * height, or flick it, and it closes; let go early and it springs back.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, Modal, PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassSurface } from "./glass";
import { useTheme } from "./theme";

export function Sheet({
  visible,
  onClose,
  children,
  /** "bottom" hugs the home indicator; "center" floats mid-screen (the shortcuts list). */
  placement = "bottom",
  maxWidth = 560,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  placement?: "bottom" | "center";
  maxWidth?: number;
}) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const pull = useSharedValue(24);
  const opacity = useSharedValue(0);
  const heightRef = useRef(400);
  const closing = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Keep the same native card alive until it is off screen. An exiting layout
  // animation would start from its layout origin and replay a completed drag.
  const dismiss = useCallback((notify: boolean) => {
    if (closing.current) return;
    closing.current = true;
    Keyboard.dismiss();
    const finish = () => {
      setMounted(false);
      if (notify) closeRef.current();
    };
    opacity.value = withTiming(0, { duration: 180 });
    pull.value = withTiming(placement === "bottom" ? heightRef.current + insets.bottom + 40 : screenHeight, { duration: 180, easing: Easing.out(Easing.quad) }, (done) => {
      if (done) runOnJS(finish)();
    });
  }, [opacity, pull, screenHeight, placement, insets.bottom]);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    if (visible) {
      // Blur the underlying composer before presenting the modal, so UIKit
      // does not restore its keyboard when the sheet is dismissed.
      Keyboard.dismiss();
      closing.current = false;
      setMounted(true);
      pull.value = 24;
      opacity.value = withTiming(1, { duration: 170 });
      pull.value = withTiming(0, { duration: 170, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      dismiss(false);
    }
  }, [visible, dismiss]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        if (closing.current) return;
        // Down follows the finger; up resists, like a real sheet.
        pull.value = g.dy > 0 ? g.dy : g.dy / 6;
      },
      onPanResponderRelease: (_e, g) => {
        if (closing.current) return;
        const h = heightRef.current || 400;
        const far = g.dy > h / 3;
        const fast = g.vy > 0.9 && g.dy > 20;
        if (far || fast) {
          dismissRef.current(true);
        } else {
          pull.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) });
        }
      },
      onPanResponderTerminate: () => {
        if (closing.current) return;
        pull.value = withTiming(0, { duration: 180 });
      },
    }),
  ).current;

  const dragged = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }] }));

  const backdrop = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => dismiss(true)} statusBarTranslucent>
      <View
        style={{
          flex: 1,
          justifyContent: placement === "center" ? "center" : "flex-end",
          alignItems: "center",
        }}
      >
          <Reanimated.View
            style={[StyleSheet.absoluteFill, backdrop]}
          >
            <Pressable
              onPress={() => dismiss(true)}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={{ flex: 1, backgroundColor: isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.25)" }}
            />
          </Reanimated.View>
          <Reanimated.View
            onLayout={(e) => { heightRef.current = e.nativeEvent.layout.height; }}
            style={[
              {
                width: "100%",
                maxWidth,
                paddingHorizontal: 10,
                marginBottom: placement === "bottom" ? Math.max(insets.bottom, 10) : insets.bottom,
              },
              dragged,
            ]}
          >
            <GlassSurface variant="regular" fallbackColor={colors.popover} style={{ borderRadius: 30, overflow: "hidden" }}>
              {/* The grabber zone: full width, comfortably tall, and the only
                  part of the card that takes the dismiss drag. */}
              <View {...pan.panHandlers} style={{ height: 28, alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong }} />
              </View>
              {children}
            </GlassSurface>
          </Reanimated.View>
      </View>
    </Modal>
  );
}
