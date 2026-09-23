/** Shared content-sized tray. Its surface stays mounted as pages and height change. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type ScrollViewInstance, type StyleProp, type ViewStyle } from "react-native";
import Reanimated, { cancelAnimation, Easing, FadeInLeft, FadeInRight, FadeOut, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReduceMotionEnabled } from "./motion";
import { useTheme } from "./theme";
import { useBlockNavGesture } from "./nav-gesture-context";

import { SheetNativePanContext, SheetExpandedContext, SheetDraggingContext, SheetGestureContext, SheetScrollView, type SheetTouchOrigin } from "./sheet-scroll";
import { canDragSheet, sheetDragDestination, sheetDragPosition, type SheetStage } from "./sheet-gesture";

import { GestureHandlerRootView, PanGestureHandler, State } from "react-native-gesture-handler";

const TRAY_DURATION = 260;
const TRAY_EASE = Easing.bezier(0.2, 0.8, 0.2, 1);

export function Sheet({ visible, onClose, children, placement = "bottom", maxWidth = 560, pageKey = "root", pageDirection = "forward", surfaceStyle, resizable = true }: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  placement?: "bottom" | "center";
  maxWidth?: number;
  surfaceStyle?: StyleProp<ViewStyle>;
  /**
   * Off: the sheet keeps its compact height. A drag up does nothing and the
   * "Drawer height" accessibility control only offers Dismiss. For a sheet
   * whose pages size their own scrollers (the agent picker's model list): an
   * expanded tray around a list that kept its own height was hard to scroll.
   */
  resizable?: boolean;
  /** Change only for navigation, never for edits or selections within a page. */
  pageKey?: string;
  pageDirection?: "forward" | "back";
}) {
  const { colors, isDark } = useTheme();
  const blockNavGesture = useBlockNavGesture();
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
  const scroll = useRef<ScrollViewInstance>(null);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [pageKey]);
  const measured = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const duration = reducedMotion ? 0 : TRAY_DURATION;
  const bottomGap = Math.max(insets.bottom, 12);
  const limit = Math.max(44, availableHeight - insets.top - bottomGap - 44);
  const [stage, setStage] = useState<SheetStage>("compact");
  const compact = Math.min(contentHeight, limit, screenHeight * 0.65);
  const canGrow = resizable && placement === "bottom";
  const expanded = canGrow ? limit : compact;
  const targetHeight = stage === "expanded" ? expanded : compact;
  const geometry = useRef({ compact, expanded, stage, canGrow });
  geometry.current = { compact, expanded, stage, canGrow };
  const origin = useRef<SheetTouchOrigin | null>(null);
  const [dragging, setDragging] = useState(false);
  const [gestureBlocked, setGestureBlocked] = useState(false);
  const dragStart = useRef(0);
  const restoreScroll = useRef<(() => void) | undefined>(undefined);
  const dragStage = useRef<SheetStage>("compact");
  const claimScroll = useCallback((source: SheetTouchOrigin) => {
    if (source.blocked) setGestureBlocked(true);
    // Touch events bubble from the innermost child. Do not let an outer
    // scroller replace that child's ownership. An outer scroller's offset
    // still matters: it must reach the top before a downward sheet drag.
    if (!origin.current) origin.current = source;
    else {
      const previous = origin.current;
      origin.current = { ...previous, offset: Math.max(previous.offset, source.offset), blocked: previous.blocked || source.blocked,
        restore: () => { previous.restore?.(); source.restore?.(); } };
    }
  }, []);

  useEffect(() => {
    bodyHeight.value = measured.current ? withTiming(targetHeight, { duration, easing: TRAY_EASE }) : targetHeight;
    if (contentHeight > 0) measured.current = true;
  }, [targetHeight, contentHeight, bodyHeight, duration]);

  const dismiss = useCallback((notify: boolean) => {
    if (closing.current) return;
    closing.current = true;
    setDragging(false);
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
      setStage("compact");
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
  const settle = (requested: SheetStage) => {
    // A fixed sheet has no expanded stage. Reporting one would tell nested
    // scrollers (the model list) to grow inside a body that does not.
    const next = geometry.current.canGrow ? requested : "compact";
    setStage(next);
    bodyHeight.value = withTiming(next === "expanded" ? geometry.current.expanded : geometry.current.compact,
      { duration: durationRef.current, easing: TRAY_EASE });
    pull.value = withTiming(0, { duration: durationRef.current, easing: TRAY_EASE });
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;
  const panRef = useRef<PanGestureHandler>(null);
  const ownsDrag = useRef(false);
  const beginDrag = (dx: number, dy: number) => {
    // With no room to grow, an upward drag over a scroller is a scroll.
    ownsDrag.current = !closing.current && canDragSheet(dx, dy, origin.current, geometry.current.stage === "expanded" || !geometry.current.canGrow);
    if (!ownsDrag.current) return;
    // Simultaneous native scrolling can move a few points before activation.
    // Keep the starting offsets when the sheet takes this gesture.
    restoreScroll.current = origin.current?.restore;
    restoreScroll.current?.();
    setDragging(true);
    cancelAnimation(bodyHeight);
    cancelAnimation(pull);
    dragStart.current = bodyHeight.value;
    dragStage.current = geometry.current.stage;
  };
  const moveDrag = (dy: number) => {
    if (!ownsDrag.current || closing.current) return;
    const next = sheetDragPosition(dragStart.current, dy, geometry.current.compact, geometry.current.expanded);
    bodyHeight.value = next.height;
    pull.value = next.pull;
  };
  const endDrag = (dy: number, vy: number, cancelled: boolean) => {
    origin.current = null;
    if (!ownsDrag.current) return;
    ownsDrag.current = false;
    restoreScroll.current?.();
    restoreScroll.current = undefined;
    setDragging(false);
    if (closing.current) return;
    if (cancelled) return settleRef.current(dragStage.current);
    const next = sheetDragDestination(dragStart.current, dy, vy, geometry.current.compact, geometry.current.expanded);
    if (next === "dismiss") dismissRef.current(true);
    else settleRef.current(next);
  };
  const dragged = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }] }));
  const backdrop = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const size = useAnimatedStyle(() => ({ height: bodyHeight.value }));
  return <Modal visible={mounted} transparent animationType="none" onShow={reveal} onRequestClose={() => dismiss(true)} statusBarTranslucent>
    <GestureHandlerRootView style={{ flex: 1 }} onTouchStart={blockNavGesture}>
    <Reanimated.View style={[StyleSheet.absoluteFill, backdrop]}>
      <Pressable onPress={() => dismiss(true)} accessibilityRole="button" accessibilityLabel="Close" style={{ flex: 1, backgroundColor: isDark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.18)" }} />
    </Reanimated.View>
    <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
      <View pointerEvents="box-none" onLayout={e => setAvailableHeight(e.nativeEvent.layout.height)} style={{ flex: 1, justifyContent: placement === "center" ? "center" : "flex-end", alignItems: "center" }}>
        <Reanimated.View accessibilityViewIsModal onAccessibilityEscape={() => dismiss(true)} style={[{ width: "100%", maxWidth, paddingHorizontal: 12, marginBottom: bottomGap }, dragged]}>
          <SheetNativePanContext.Provider value={panRef}>
          <SheetGestureContext.Provider value={claimScroll}>
          <SheetDraggingContext.Provider value={dragging || gestureBlocked}>
          <SheetExpandedContext.Provider value={stage === "expanded"}>
          <PanGestureHandler ref={panRef} enabled={!gestureBlocked} activeOffsetY={[-8, 8]} failOffsetX={[-16, 16]}
            onGestureEvent={event => moveDrag(event.nativeEvent.translationY)}
            onHandlerStateChange={event => {
              const g = event.nativeEvent;
              if (g.state === State.ACTIVE) beginDrag(g.translationX, g.translationY);
              else if (g.state === State.END) endDrag(g.translationY, g.velocityY / 1000, false);
              else if (g.state === State.CANCELLED || g.state === State.FAILED) endDrag(0, 0, true);
            }}>
          <View onStartShouldSetResponderCapture={() => { origin.current = null; return false; }}
            onTouchEnd={() => setGestureBlocked(false)} onTouchCancel={() => setGestureBlocked(false)} style={[{ borderRadius: 32, borderCurve: "continuous", overflow: "hidden", backgroundColor: colors.popover }, surfaceStyle]}>
            {/* The full surface participates; nested scrollers declare their touch origin. */}
            <View onTouchStart={() => { origin.current = null; }} accessibilityRole="adjustable" accessibilityLabel="Drawer height"
              accessibilityValue={{ text: stage }}
              accessibilityActions={resizable
                ? [{ name: "increment", label: "Expand" }, { name: "decrement", label: "Collapse" }, { name: "dismiss", label: "Dismiss" }]
                : [{ name: "dismiss", label: "Dismiss" }]}
              onAccessibilityAction={event => {
                if (event.nativeEvent.actionName === "dismiss") dismiss(true);
                else settle(event.nativeEvent.actionName === "increment" ? "expanded" : "compact");
              }} style={{ height: 28, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: 32, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }} />
            </View>
            <Reanimated.View style={[{ overflow: "hidden" }, size]}>
              <SheetScrollView ref={scroll} style={StyleSheet.absoluteFill} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" showsVerticalScrollIndicator={false} bounces={false} nestedScrollEnabled>
                <Reanimated.View key={pageKey} onLayout={e => { if (stage === "compact") setContentHeight(e.nativeEvent.layout.height); }} entering={reducedMotion || !measured.current ? undefined : (pageDirection === "forward" ? FadeInRight : FadeInLeft).duration(TRAY_DURATION).easing(TRAY_EASE)} exiting={reducedMotion ? undefined : FadeOut.duration(160)}>
                  {children}
                </Reanimated.View>
              </SheetScrollView>
            </Reanimated.View>
          </View>
          </PanGestureHandler>
          </SheetExpandedContext.Provider>
          </SheetDraggingContext.Provider>
          </SheetGestureContext.Provider>
          </SheetNativePanContext.Provider>
        </Reanimated.View>
      </View>
    </KeyboardAvoidingView>
    </GestureHandlerRootView>
  </Modal>;
}
