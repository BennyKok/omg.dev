/**
 * A card that slides up from the bottom over a dimmed backdrop.
 *
 * THIS DID NOT EXIST BEFORE THE NEW/EDIT BOT SHEET NEEDED IT. The web spec
 * for that sheet (docs/design/bot-mode/spec.md §5) calls for "`BottomSheet`,
 * same drawer-on-mobile / centered-dialog-on-desktop behavior as every other
 * sheet in the app" — true of the web, where `web/src/components/ui/sheet.tsx`
 * is an established primitive. It is not true of THIS app: nothing under
 * mobile/ is named or shaped like a sheet (checked across every mobile
 * branch in the repo, not just this one — see the PR description). The
 * closest existing idioms are `menu.tsx`'s anchored system Menu, which is
 * the right tool for "pick one of a few things" and the wrong one for a
 * multi-field form, and a bare `Modal`, which is what this file exists to
 * avoid reaching for directly — an un-styled full-screen presentation reads
 * as a different app for the three seconds it's open.
 *
 * So this is a small, reusable primitive built from what the app already
 * ships: RN's own `Modal` for the presentation host (no native module),
 * `react-native-reanimated` for the slide (already a dependency — see
 * bot-avatar.tsx and motion.tsx), and the app's own theme tokens for the
 * card chrome, so a sheet build on this looks like it grew here rather than
 * being dropped in. Future sheets should build on this one instead of each
 * reaching for `Modal` again.
 *
 * NO DRAG-TO-DISMISS. `react-native-gesture-handler` is not a dependency
 * (checked package.json), and building a pan responder by hand for a single
 * call site was not worth the edge cases (keyboard interaction, scroll-view
 * children fighting the gesture). Dismissal is the backdrop tap and the
 * sheet's own header actions — the same two ways `menu.tsx`'s Menu and
 * `toast.tsx`'s toast are already dismissed in this app.
 */

import { useEffect, useRef } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "./theme";

export function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { colors, radius, space, motion } = useTheme();
  const insets = useSafeAreaInsets();

  // Kept mounted through the close animation. `Modal`'s own `visible` prop
  // would unmount instantly and skip the slide-down entirely.
  const mounted = useRef(visible);
  const progress = useSharedValue(0);

  useEffect(() => {
    const easing = Easing.bezier(...motion.easeSmoothOut);
    if (visible) {
      mounted.current = true;
      progress.value = withTiming(1, { duration: motion.medium, easing });
    } else if (mounted.current) {
      progress.value = withTiming(0, { duration: motion.fast, easing }, (finished) => {
        if (finished) mounted.current = false;
      });
    }
  }, [visible, progress, motion]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.5 }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * 400 }],
  }));

  if (!visible && !mounted.current) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable accessibilityLabel="Dismiss" onPress={onClose} style={styleAbsoluteFill}>
          <Reanimated.View style={[styleAbsoluteFill, { backgroundColor: "#000" }, backdropStyle]} />
        </Pressable>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Reanimated.View
            style={[
              {
                backgroundColor: colors.card,
                borderTopLeftRadius: radius.xl,
                borderTopRightRadius: radius.xl,
                paddingBottom: Math.max(insets.bottom, space.lg),
                maxHeight: "88%",
              },
              sheetStyle,
            ]}
          >
            {/* A grabber, not a functioning handle (no drag-to-dismiss) — it
                still reads as "this is a sheet" at a glance, matching the
                system's own sheet chrome. */}
            <View style={{ alignItems: "center", paddingTop: space.sm, paddingBottom: space.xs }}>
              <View
                style={{
                  width: 36,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: colors.borderStrong,
                }}
              />
            </View>
            {children}
          </Reanimated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styleAbsoluteFill = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
