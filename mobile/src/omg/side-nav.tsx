/**
 * THE SIDE NAV on Live.
 *
 * Everything that is a PLACE rather than a filter now lives in one column at
 * the leading edge: which computer you are talking to, then Live,
 * Notifications, Schedules, Settings, and the shortcuts card on a device that
 * has a keyboard. They used to be an "ellipsis" overflow menu on the header,
 * which is where iOS puts things it cannot fit — three screens and a machine
 * switcher hidden behind a glyph that says nothing about any of them.
 *
 * ONE SET OF ROWS, TWO PRESENTATIONS. `SideNavPanel` draws the column.
 * `SideNavDrawer` slides that same panel in over the phone; the iPad rail
 * renders it inline as a footer, because a 320pt column is already on screen
 * and sliding a second one over it would be ceremony for nothing. The rows
 * themselves come from side-nav-items.ts, so neither presentation can drift
 * into carrying a different list.
 *
 * NOT A MODAL. The drawer is an absolutely-positioned overlay inside the Live
 * screen, so the computer row's `DropdownMenu` — a real SwiftUI `Menu`, see
 * menu.tsx — hangs off an ordinary view in the ordinary hierarchy, exactly
 * like every other menu in the app. The caller hides its navigation-bar items
 * while the drawer is open (the bar is transparent and draws nothing of its
 * own), so there is nothing left above the overlay to show through it.
 *
 * The machine switcher is the picker's, not this file's: `computerOptions`
 * arrives already built by computer-picker.ts, which stays the single owner of
 * what switching a computer means.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Keyboard,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Reanimated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  type SharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AndroidSymbol, SFSymbol } from "expo-symbols";

import { Icon, StatusDot } from "../components";
import { DropdownMenu, type MenuOption } from "./menu";
import { PressableScale, useReduceMotionEnabled } from "./motion";
import { sideNavRows, type SideNavRowKey } from "./side-nav-items";
import { Text } from "./text";
import { useTheme } from "./theme";

/** The glyph for each row. Kept with the view so the row list stays testable. */
const GLYPH: Record<SideNavRowKey, { ios: SFSymbol; android: AndroidSymbol }> = {
  live: { ios: "bolt.fill", android: "bolt" },
  notifications: { ios: "bell", android: "notifications" },
  schedules: { ios: "calendar.badge.clock", android: "schedule" },
  settings: { ios: "gearshape", android: "settings" },
  shortcuts: { ios: "keyboard", android: "keyboard" },
};

/** Wide enough for a machine name, never more than most of a phone. */
export const SIDE_NAV_WIDTH = 288;
export const sideNavWidth = (screenWidth: number) => Math.min(SIDE_NAV_WIDTH, Math.round(screenWidth * 0.84));

export type SideNavProps = {
  /** Where the reader is, so the matching row can draw selected. */
  pathname: string;
  /** Built by computer-picker.ts — the one definition of switching machines. */
  computerOptions: MenuOption[];
  machineName: string;
  online: boolean;
  /** Pushes on the phone, swaps the pane on the iPad. The caller decides. */
  navigate: (href: string) => void;
  /** Opens the shortcuts card. Omitted when the binary cannot deliver key commands. */
  onShortcuts?: () => void;
  /**
   * Put the nav away. The drawer passes its own close; the iPad rail, which is
   * always on screen, passes nothing.
   *
   * Called on EVERY row press, including the row you are already on. Tapping
   * "Live" from Live is a person saying "take me back to the list" — doing
   * nothing at all leaves the drawer sitting there looking broken, and pushing
   * the route would stack a second copy of the screen you can see.
   */
  onDismiss?: () => void;
};

function NavRow({
  label,
  ios,
  android,
  selected,
  onPress,
  accessory,
}: {
  label: string;
  ios: SFSymbol;
  android: AndroidSymbol;
  selected?: boolean;
  onPress?: () => void;
  accessory?: React.ReactNode;
}) {
  const { colors, radius, type, space } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      scale={0.98}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }: { pressed: boolean }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        height: 44,
        paddingHorizontal: space.sm,
        borderRadius: radius.md,
        /**
         * SELECTED IS A TINT, NOT A BLOCK. The folder pills next door already
         * say "current" with a shade and an outline; a filled bar here would
         * be the loudest thing in a column of quiet rows.
         */
        backgroundColor: pressed
          ? colors.cardPressed
          : selected
            ? colors.accent
            : "transparent",
      })}
    >
      <Icon
        ios={ios}
        android={android}
        size={18}
        color={selected ? colors.text : colors.textSecondary}
      />
      <Text
        numberOfLines={1}
        style={{
          ...type.callout,
          flex: 1,
          fontWeight: selected ? "600" : "400",
          color: selected ? colors.text : colors.textSecondary,
        }}
      >
        {label}
      </Text>
      {accessory}
    </PressableScale>
  );
}

/**
 * The column itself. Used inline by the iPad rail and inside the drawer on a
 * phone; it draws no surface of its own, so whatever hosts it owns the paint.
 */
export function SideNavPanel({
  pathname,
  computerOptions,
  machineName,
  online,
  navigate,
  onShortcuts,
  onDismiss,
}: SideNavProps) {
  const { colors, radius, type, space } = useTheme();
  const rows = sideNavRows({ pathname, keyboardShortcuts: !!onShortcuts });
  return (
    <View style={{ gap: space.xs }}>
      {/* THE MACHINE, FIRST. It is the context every row below it runs in:
          which box these sessions are on. The menu is the picker's own, so
          this row is a trigger and nothing more. */}
      <DropdownMenu title="Computer" options={computerOptions}>
        <View
          accessibilityRole="button"
          accessibilityLabel={`Computer: ${machineName}. Change`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            height: 48,
            paddingHorizontal: space.sm,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Icon lucide="monitor" size={18} color={colors.textSecondary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={1}
              style={{ ...type.callout, fontWeight: "600", color: colors.text }}
            >
              {machineName}
            </Text>
          </View>
          <StatusDot busy={online} size={7} />
          <Icon ios="chevron.up.chevron.down" android="unfold_more" size={12} color={colors.textMuted} />
        </View>
      </DropdownMenu>
      <View style={{ height: 1, backgroundColor: colors.border, marginVertical: space.xs }} />
      {rows.map((row) =>
        row.kind === "page" ? (
          <NavRow
            key={row.key}
            label={row.label}
            {...GLYPH[row.key]}
            selected={row.current}
            onPress={() => {
              onDismiss?.();
              // The row you are already on closes the nav and stays put.
              // Navigating to the open screen would push a second copy of it.
              if (!row.current) navigate(row.href);
            }}
          />
        ) : (
          <NavRow
            key={row.key}
            label={row.label}
            {...GLYPH[row.key]}
            onPress={() => {
              onDismiss?.();
              onShortcuts?.();
            }}
          />
        ),
      )}
    </View>
  );
}

/**
 * The phone's opaque drawer. One progress value also moves the main screen.
 *
 * Drag it left, or tap the page beside it, to put it away. It keeps the same
 * card alive until it is off screen rather than unmounting on `visible`, so
 * the exit animation can actually run.
 */
export function SideNavDrawer({
  visible,
  onClose,
  progress,
  ...panel
}: SideNavProps & { visible: boolean; onClose: () => void; progress: SharedValue<number> }) {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const width = sideNavWidth(screenWidth);
  const reducedMotion = useReduceMotionEnabled();
  const [mounted, setMounted] = useState(visible);
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  const closing = useRef(false);
  const dragStart = useRef(1);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const dismiss = useCallback(
    (notify: boolean) => {
      if (closing.current) return;
      closing.current = true;
      const finish = () => {
        setMounted(false);
        if (notify) closeRef.current();
      };
      progress.value = withTiming(
        0,
        { duration: reducedMotion ? 0 : 220, easing: Easing.out(Easing.cubic) },
        (done) => {
          if (done) runOnJS(finish)();
        },
      );
    },
    [progress, reducedMotion],
  );
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    if (visible) {
      // The composer keeps focus under the drawer otherwise: the nav slides
      // over the list and the keyboard stays up beneath it, covering half of
      // what was just opened.
      Keyboard.dismiss();
      closing.current = false;
      setMounted(true);
      progress.value = withTiming(1, { duration: reducedMotion ? 0 : 260, easing: Easing.out(Easing.cubic) });
    } else if (mountedRef.current) {
      dismissRef.current(false);
    }
    // `mounted` is read through a ref on purpose: it changes as a RESULT of
    // this effect, and listing it would replay the opening animation from
    // -width on the very next render, a visible stutter every time the nav
    // is opened.
  }, [visible, progress, reducedMotion]);

  const pan = useMemo(() =>
    PanResponder.create({
      // Only a real leftward drag. Anything vertical belongs to the list of
      // rows, which scrolls when the nav is taller than the screen.
      onMoveShouldSetPanResponder: (_event, gesture) =>
        gesture.dx < -6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: () => {
        dragStart.current = progress.value;
        closing.current = false;
        cancelAnimation(progress);
      },
      onPanResponderMove: (_event, gesture) => {
        progress.value = Math.max(0, Math.min(1, dragStart.current + gesture.dx / width));
      },
      onPanResponderRelease: (_event, gesture) => {
        const far = progress.value < 2 / 3;
        const flick = gesture.vx < -0.5;
        if (far || flick) dismissRef.current(true);
        else progress.value = withTiming(1, { duration: reducedMotion ? 0 : 160 });
      },
      onPanResponderTerminate: () => {
        progress.value = withTiming(1, { duration: reducedMotion ? 0 : 160 });
      },
    }),
    [progress, width, reducedMotion],
  );

  // Android's back gesture closes the nav before it leaves the screen. This is
  // a plain overlay rather than a Modal (see the note at the top of this file),
  // so nothing does that for free.
  useEffect(() => {
    if (!mounted || Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      dismissRef.current(true);
      return true;
    });
    return () => subscription.remove();
  }, [mounted]);

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.value - 1) * width }] }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: width * progress.value }],
    borderTopLeftRadius: 40 * progress.value,
    borderBottomLeftRadius: 40 * progress.value,
  }));

  if (!mounted) return null;
  return (
    <View
      // VoiceOver must not wander into the list behind an open drawer, and
      // touches cannot reach it either: the scrim below covers the screen.
      accessibilityViewIsModal
      style={[StyleSheet.absoluteFill, { zIndex: 200, elevation: 8 }]}
    >
      <Reanimated.View style={[StyleSheet.absoluteFill, {
        overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong,
      }, scrimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close navigation"
          onPress={() => dismissRef.current(true)}
          {...pan.panHandlers}
        >
          {/* Dim the exposed main screen; the drawer itself is opaque. */}
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: "rgba(0, 0, 0, 0.28)" },
            ]}
          />
        </Pressable>
      </Reanimated.View>
      <Reanimated.View
        style={[{ position: "absolute", left: 0, top: 0, bottom: 0, width }, panelStyle]}
        {...pan.panHandlers}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: colors.bg,
            borderRightWidth: StyleSheet.hairlineWidth,
            borderRightColor: colors.border,
          }}
        >
          <ScrollView
            contentContainerStyle={{
              paddingTop: insets.top + space.sm,
              paddingBottom: insets.bottom + space.lg,
              paddingHorizontal: space.sm,
            }}
          >
            <SideNavPanel {...panel} onDismiss={() => dismissRef.current(true)} />
          </ScrollView>
        </View>
      </Reanimated.View>
    </View>
  );
}

/**
 * The control that opens the drawer, for the leading edge of the header.
 *
 * It wears the machine's online dot. The computer chip used to lead the bar
 * and that dot was the only always-visible word on whether the box is up;
 * moving the switcher into the nav must not cost that, so the button that now
 * stands in its place carries it.
 */
export function SideNavButton({
  onPress,
  online,
  machineName,
}: {
  onPress: () => void;
  online: boolean;
  machineName: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Navigation. Computer: ${machineName}`}
      hitSlop={8}
      style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
    >
      <Icon ios="sidebar.leading" android="menu" size={20} color={colors.textSecondary} />
      <View style={{ position: "absolute", right: 5, bottom: 6 }}>
        <StatusDot busy={online} size={7} />
      </View>
    </Pressable>
  );
}
