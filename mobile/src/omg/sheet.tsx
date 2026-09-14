/** Shared content-sized tray. Its surface stays mounted as pages and height change. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Reanimated, { Easing, FadeInLeft, FadeInRight, FadeOut, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceMotionEnabled } from "./motion";
import { useTheme } from "./theme";

const TRAY_DURATION = 260;
const TRAY_EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

export function Sheet({ visible, onClose, children, placement = "bottom", maxWidth = 560, pageKey = "root", pageDirection = "forward" }: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  placement?: "bottom" | "center";
  maxWidth?: number;
  /** Change only for navigation, never for edits or selections within a page. */
  pageKey?: string;
  pageDirection?: "forward" | "back";
}) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const reducedMotion = useReduceMotionEnabled();
  const [mounted, setMounted] = useState(visible);
  const [availableHeight, setAvailableHeight] = useState(screenHeight);
  const [contentHeight, setContentHeight] = useState(0);
  const pull = useSharedValue(screenHeight);
  const opacity = useSharedValue(0);
  const bodyHeight = useSharedValue(0);
  const closing = useRef(false);
  const scroll = useRef<ScrollView>(null);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [pageKey]);
  const measured = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const duration = reducedMotion ? 0 : TRAY_DURATION;
  const bottomGap = Math.max(insets.bottom, 12);
  const limit = Math.max(44, availableHeight - insets.top - bottomGap - 44);
  const targetHeight = Math.min(contentHeight, limit);
  const heightRef = useRef(targetHeight + 28);
  heightRef.current = targetHeight + 28;

  useEffect(() => {
    bodyHeight.value = measured.current ? withTiming(targetHeight, { duration, easing: TRAY_EASE }) : targetHeight;
    if (contentHeight > 0) measured.current = true;
  }, [targetHeight, contentHeight, bodyHeight, duration]);

  const dismiss = useCallback((notify: boolean) => {
    if (closing.current) return;
    closing.current = true;
    Keyboard.dismiss();
    opacity.value = withTiming(0, { duration });
    pull.value = withTiming(screenHeight, { duration, easing: TRAY_EASE }, (done) => {
      if (done) runOnJS(finish)(notify);
    });
    function finish(shouldNotify: boolean) {
      setMounted(false);
      if (shouldNotify) closeRef.current();
    }
  }, [opacity, pull, screenHeight, duration]);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    if (visible) {
      Keyboard.dismiss();
      closing.current = false;
      measured.current = false;
      setMounted(true);
      pull.value = screenHeight;
      opacity.value = 0;
      if (mounted) reveal();
    } else if (mounted) dismiss(false);
    // Opening is an event; geometry and keyboard changes must not reopen a tray.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const reveal = () => {
    opacity.value = withTiming(1, { duration });
    pull.value = withTiming(0, { duration, easing: TRAY_EASE });
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_e, g) => {
      if (!closing.current) pull.value = g.dy > 0 ? g.dy : g.dy / 6;
    },
    onPanResponderRelease: (_e, g) => {
      if (closing.current) return;
      if (g.dy > heightRef.current / 3 || (g.vy > 0.9 && g.dy > 20)) dismissRef.current(true);
      else pull.value = withTiming(0, { duration: durationRef.current, easing: TRAY_EASE });
    },
    onPanResponderTerminate: () => {
      if (!closing.current) pull.value = withTiming(0, { duration: durationRef.current, easing: TRAY_EASE });
    },
  })).current;
  const dragged = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }] }));
  const backdrop = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const size = useAnimatedStyle(() => ({ height: bodyHeight.value }));
  return <Modal visible={mounted} transparent animationType="none" onShow={reveal} onRequestClose={() => dismiss(true)} statusBarTranslucent>
    <Reanimated.View style={[StyleSheet.absoluteFill, backdrop]}>
      <Pressable onPress={() => dismiss(true)} accessibilityRole="button" accessibilityLabel="Close" style={{ flex: 1, backgroundColor: isDark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.18)" }} />
    </Reanimated.View>
    <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
      <View pointerEvents="box-none" onLayout={e => setAvailableHeight(e.nativeEvent.layout.height)} style={{ flex: 1, justifyContent: placement === "center" ? "center" : "flex-end", alignItems: "center" }}>
        <Reanimated.View accessibilityViewIsModal onAccessibilityEscape={() => dismiss(true)} style={[{ width: "100%", maxWidth, paddingHorizontal: 12, marginBottom: bottomGap }, dragged]}>
          <View style={{ borderRadius: 32, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.popover }}>
            {/* The handle owns drag dismissal so scrolling and text selection remain independent. */}
            <View {...pan.panHandlers} style={{ height: 28, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }} />
            </View>
            <Reanimated.View style={[{ overflow: "hidden" }, size]}>
              <ScrollView ref={scroll} style={StyleSheet.absoluteFill} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} nestedScrollEnabled>
                <Reanimated.View key={pageKey} onLayout={e => setContentHeight(e.nativeEvent.layout.height)} entering={reducedMotion || !measured.current ? undefined : (pageDirection === "forward" ? FadeInRight : FadeInLeft).duration(TRAY_DURATION).easing(TRAY_EASE)} exiting={reducedMotion ? undefined : FadeOut.duration(160)}>
                  {children}
                </Reanimated.View>
              </ScrollView>
            </Reanimated.View>
          </View>
        </Reanimated.View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
