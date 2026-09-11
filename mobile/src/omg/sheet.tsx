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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, PanResponder, Pressable, StyleSheet, View } from "react-native";
import Reanimated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
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
  /**
   * The Modal unmounts on the same frame `visible` drops, which would cut the
   * exit animation. Keep it mounted one beat longer so the card can slide
   * away, then let the Modal go.
   */
  const [mounted, setMounted] = useState(visible);
  /**
   * A DRAG-DISMISS ENDS WHERE THE FINGER LEFT IT. The exit animation
   * snapshots the card's LAYOUT position, not its dragged transform, so a
   * card that had been pulled off the bottom reappeared in place to fade
   * out. When the drag closes the card, the exit animation is skipped and
   * the Modal goes at once; the pull already did the leaving.
   */
  const [dragClosed, setDragClosed] = useState(false);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      setDragClosed(false);
      return;
    }
    if (dragClosed) {
      setMounted(false);
      return;
    }
    const t = setTimeout(() => setMounted(false), 160);
    return () => clearTimeout(t);
  }, [visible, dragClosed]);

  const pull = useSharedValue(0);
  const [height, setHeight] = useState(0);
  const heightRef = useRef(0);
  heightRef.current = height;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (visible) pull.value = 0;
  }, [visible, pull]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => {
        // Down follows the finger; up resists, like a real sheet.
        pull.value = g.dy > 0 ? g.dy : g.dy / 6;
      },
      onPanResponderRelease: (_e, g) => {
        const h = heightRef.current || 400;
        const far = g.dy > h / 3;
        const fast = g.vy > 0.9 && g.dy > 20;
        if (far || fast) {
          // Capture the function, not the ref: a ref object handed to a
          // worklet is frozen, and every later `.current =` warns.
          const close = closeRef.current;
          const finish = () => {
            setDragClosed(true);
            close();
          };
          pull.value = withTiming(h + 40, { duration: 160 }, (done) => {
            if (done) runOnJS(finish)();
          });
        } else {
          pull.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.quad) });
        }
      },
      onPanResponderTerminate: () => {
        pull.value = withTiming(0, { duration: 180 });
      },
    }),
  ).current;

  const dragged = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }] }));

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View
        style={{
          flex: 1,
          justifyContent: placement === "center" ? "center" : "flex-end",
          alignItems: "center",
        }}
      >
        {visible ? (
          <Reanimated.View
            entering={FadeIn.duration(120)}
            exiting={dragClosed ? undefined : FadeOut.duration(120)}
            style={StyleSheet.absoluteFill}
          >
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={{ flex: 1, backgroundColor: isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.25)" }}
            />
          </Reanimated.View>
        ) : null}
        {visible ? (
          <Reanimated.View
            entering={FadeInDown.duration(170).easing(Easing.out(Easing.cubic))}
            exiting={dragClosed ? undefined : FadeOutDown.duration(130)}
            onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
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
        ) : null}
      </View>
    </Modal>
  );
}
