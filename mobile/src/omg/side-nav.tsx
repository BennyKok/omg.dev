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
 * `SideNavDrawer` slides that same panel in, at every width including the
 * iPad. It used to be pinned into the foot of the iPad rail instead, on the
 * reasoning that a 320pt column was already on screen -- but that column was
 * then carrying the account header, the project chips, the session list and
 * six nav rows at once, and the list lost. The rows come from
 * side-nav-items.ts either way, so no presentation can drift into carrying a
 * different list.
 *
 * NOT A MODAL. The drawer is an absolutely-positioned overlay inside the Live
 * screen, so the computer row's `DropdownMenu` — a real SwiftUI `Menu`, see
 * menu.tsx — hangs off an ordinary view in the ordinary hierarchy, exactly
 * like every other menu in the app. The caller keeps its header row in page
 * content, so the controls move with the page and stay below this overlay.
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

import { StatusDot } from "../components";
import { LucideIcon, type LucideName } from "./lucide";
import { BrandWordmark } from "./brand-mark";
import { GlassSurface } from "./glass";
import { DropdownMenu, type MenuOption } from "./menu";
import { PressableScale, useReduceMotionEnabled } from "./motion";
import { sideNavRows, type SideNavRowKey } from "./side-nav-items";
import { Text } from "./text";
import { useTheme } from "./theme";

/**
 * The glyph for each row. Kept with the view so the row list stays testable.
 *
 * THIS COLUMN IS LUCIDE, and it is the exception rather than the new rule.
 *
 * Everywhere else in the app a glyph is an SF Symbol, because those carry the
 * system's optical weights and match the bar, the keyboard and the menus for
 * free. The side navigation is the one surface where the set has to read as
 * ONE family: eight rows stacked in a column, where SF Symbols' varying
 * optical weights and widths showed up as a ragged edge that a single icon
 * cannot -- `bolt` is dense, `archivebox` is airy, and stacked they looked
 * borrowed from different apps.
 *
 * Lucide is one stroke weight by construction, so the column lines up. Do not
 * take this as licence to convert other screens; see lucide.tsx for why the
 * font is here at all.
 */
const GLYPH: Record<SideNavRowKey, LucideName> = {
  // "Chat", so a speech bubble rather than the old `bolt`, which said
  // "fast" about a page that is a conversation.
  live: "message-circle",
  archive: "archive",
  notifications: "bell",
  schedules: "calendar-clock",
  settings: "settings",
  shortcuts: "keyboard",
};

/** Wide enough for a machine name, never more than most of a phone. */
export const SIDE_NAV_WIDTH = 320;
export const SIDE_NAV_RADIUS = 56;
export const sideNavWidth = (screenWidth: number) => Math.min(SIDE_NAV_WIDTH, Math.round(screenWidth * 0.72));

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
  glyph,
  selected,
  onPress,
  accessory,
}: {
  label: string;
  glyph: LucideName;
  selected?: boolean;
  onPress?: () => void;
  accessory?: React.ReactNode;
}) {
  const { colors, radius, type } = useTheme();
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
        gap: 12,
        minHeight: 48,
        paddingVertical: 10,
        paddingHorizontal: 12,
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
      <View style={{ width: 28, alignItems: "center", justifyContent: "center" }}>
        <LucideIcon name={glyph} size={22} color={colors.text} />
      </View>
      <Text
        numberOfLines={1}
        style={{
          ...type.body,
          flex: 1,
          fontWeight: selected ? "600" : "400",
          color: colors.text,
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
      {onDismiss ? (
        <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 20 }}>
          <BrandWordmark size={28} holeColor={colors.bg} />
        </View>
      ) : null}
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
            gap: 12,
            minHeight: 56,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: radius.md,
          }}
        >
          <View style={{ width: 28, alignItems: "center" }}>
            <LucideIcon name="monitor" size={22} color={colors.text} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={2}
              style={{ ...type.body, fontWeight: "600", color: colors.text }}
            >
              {machineName}
            </Text>
          </View>
          <StatusDot busy={online} size={7} />
          <LucideIcon name="chevrons-up-down" size={12} color={colors.textMuted} />
        </View>
      </DropdownMenu>
      <View style={{ height: 12 }} />
      {rows.map((row) =>
        row.kind === "page" ? (
          <NavRow
            key={row.key}
            label={row.label}
            glyph={GLYPH[row.key]}
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
            glyph={GLYPH[row.key]}
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
/** One gesture owner for both the screen edge and the open drawer. */
export function useSideNavGesture({ visible, onOpen, onClose, progress, enabled, width }: {
  visible: boolean; onOpen: () => void; onClose: () => void;
  progress: SharedValue<number>; enabled: boolean; width: number;
}) {
  const reducedMotion = useReduceMotionEnabled();
  const [mounted, setMounted] = useState(visible);
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  const closing = useRef(false);
  const dragStart = useRef(1);
  const openingDrag = useRef(false);
  const blocked = useRef<"none" | "opening" | "all">("none");
  const dragging = useRef(false);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
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
      if (!dragging.current) progress.value = withTiming(1, { duration: reducedMotion ? 0 : 260, easing: Easing.out(Easing.cubic) });
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
      onStartShouldSetPanResponderCapture: () => {
        // Descendant controls can exclude this touch sequence
        // in onTouchStart, after this capture phase. Keep the exclusion even
        // when the native scroll view cancels child touches during a drag.
        blocked.current = "none";
        return false;
      },
      // Capture only horizontal intent. Vertical list drags stay with the list.
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        enabled && blocked.current !== "all" && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5 &&
        (mountedRef.current ? gesture.dx < 0 : blocked.current === "none" && gesture.x0 <= 24 && gesture.dx > 0),
      onPanResponderGrant: () => {
        openingDrag.current = !mountedRef.current;
        dragging.current = true;
        dragStart.current = progress.value;
        if (openingDrag.current) {
          Keyboard.dismiss();
          setMounted(true);
          openRef.current();
        }
        closing.current = false;
        cancelAnimation(progress);
      },
      onPanResponderMove: (_event, gesture) => {
        progress.value = Math.max(0, Math.min(1, dragStart.current + gesture.dx / width));
      },
      onPanResponderRelease: (_event, gesture) => {
        dragging.current = false;
        const opens = gesture.vx > 0.5 || (gesture.vx >= -0.5 &&
          progress.value >= (openingDrag.current ? 1 / 3 : 2 / 3));
        if (opens) progress.value = withTiming(1, { duration: reducedMotion ? 0 : 160 });
        else dismissRef.current(true);
      },
      onPanResponderTerminate: () => {
        dragging.current = false;
        if (openingDrag.current) dismissRef.current(true);
        else progress.value = withTiming(1, { duration: reducedMotion ? 0 : 160 });
      },
    }),
    [progress, width, reducedMotion, enabled],
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

  return {
    mounted, dismiss: () => dismissRef.current(true), panHandlers: pan.panHandlers,
    blockOpeningGesture: () => { if (blocked.current !== "all") blocked.current = "opening"; },
    blockGesture: () => { blocked.current = "all"; },
  };
}

export function SideNavDrawer({ progress, controller, ...panel }: SideNavProps & {
  progress: SharedValue<number>; controller: ReturnType<typeof useSideNavGesture>;
}) {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const width = sideNavWidth(screenWidth);
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.value - 1) * width }] }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: width * progress.value }],
    borderTopLeftRadius: SIDE_NAV_RADIUS * progress.value,
    borderBottomLeftRadius: SIDE_NAV_RADIUS * progress.value,
  }));

  if (!controller.mounted) return null;
  return (
    <View
      // VoiceOver must not wander into the list behind an open drawer, and
      // touches cannot reach it either: the scrim below covers the screen.
      accessibilityViewIsModal
      style={[StyleSheet.absoluteFill, { zIndex: 200, elevation: 8 }]}
    >
      <Reanimated.View style={[StyleSheet.absoluteFill, {
        overflow: "hidden", borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderStrong,
      }, scrimStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="Close navigation"
          onPress={controller.dismiss}
          {...controller.panHandlers}
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
        {...controller.panHandlers}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: colors.bg,
          }}
        >
          <ScrollView
            contentContainerStyle={{
              paddingTop: insets.top + space.sm,
              paddingBottom: insets.bottom + space.lg,
              paddingHorizontal: 12,
            }}
          >
            <SideNavPanel {...panel} onDismiss={controller.dismiss} />
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
  floating = false,
}: {
  onPress: () => void;
  online: boolean;
  machineName: string;
  floating?: boolean;
}) {
  const { colors } = useTheme();
  const button = (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Navigation. Computer: ${machineName}`}
      hitSlop={8}
      style={{ width: floating ? 44 : 36, height: floating ? 44 : 36, alignItems: "center", justifyContent: "center" }}
    >
      <View accessible={false} style={{ width: 20, height: 16, justifyContent: "center", gap: 5 }}>
        <View style={{ width: 20, height: 2, borderRadius: 1, backgroundColor: colors.textSecondary }} />
        <View style={{ width: 13, height: 2, borderRadius: 1, backgroundColor: colors.textSecondary }} />
      </View>
      <View style={{ position: "absolute", right: floating ? 9 : 5, bottom: floating ? 10 : 6 }}>
        <StatusDot busy={online} size={7} />
      </View>
    </Pressable>
  );
  return floating ? (
    <GlassSurface fallbackColor={colors.card} variant="regular" style={{ borderRadius: 22 }}>
      {button}
    </GlassSurface>
  ) : button;
}
