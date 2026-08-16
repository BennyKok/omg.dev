/**
 * Presentational pieces shared by the list screens. No data fetching here —
 * these take what they render, so a screen stays the only place that knows
 * where state comes from.
 */

import {
  ActivityIndicator,
  Dimensions,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Haptics from "expo-haptics";
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Text, TextInput } from "./omg/text";
import {
  SymbolView,
  type AndroidSymbol,
  type SFSymbol,
  type SymbolWeight,
} from "expo-symbols";

import { agentIcon } from "./omg/agent-icons";
import type { Attachment } from "./omg/attachments";
import { GlassSurface, LIQUID_GLASS } from "./omg/glass";
import { LucideIcon, type LucideName } from "./omg/lucide";
import {
  orderWindows,
  providerKindForAgent,
  type ProviderUsage,
  type UsageWindow,
} from "./omg/usage";
import type { OmgColors } from "./omg/palette";
import { DropdownMenu, type MenuOption } from "./omg/menu";
import { PressableScale, useListItemMotion } from "./omg/motion";
import { useTheme } from "./omg/theme";

/**
 * Tailwind's `bg-success/30` in a language React Native understands. The web
 * expresses these indicator colours as alpha over a token, and the token is
 * a hex string here, so the two stay comparable rather than becoming two
 * hand-picked colours that drift.
 */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Leftward drag past this, or a fast enough flick, archives the row. */
const SWIPE_ARCHIVE_PX = 96;
const SWIPE_ARCHIVE_VELOCITY = 0.5;
/** How far the card travels before the red behind it is at full strength. */
const REVEAL_WIDTH = 96;
const SCREEN_WIDTH = Dimensions.get("window").width;

/**
 * THE session indicator, matched to the web surface exactly.
 *
 * The web defines it once (`STATUS_DOT_BUSY` / `STATUS_DOT_IDLE` in
 * web/src/App.tsx) precisely so the surfaces cannot drift, so this mirrors
 * those two rules rather than inventing a phone-flavoured version:
 *
 *   busy — `animate-pulse bg-warning`: amber, PULSING. It draws the eye
 *          because "an agent is working right now" is the one thing on this
 *          screen worth looking at. A spinner said the same thing louder and
 *          in the wrong colour.
 *   idle — `bg-success/30 ring-1 ring-inset ring-success/20`: green at 30%
 *          with a fainter ring inside it. Deliberately quiet — a wall of
 *          full-strength green marks "nothing is happening" as if it were
 *          news.
 *
 * Blocked keeps the pause glyph, which the web also draws in warning.
 */
export function SessionStatusDot({
  busy,
  /**
   * No agent is attached at all — a session that has finished and can be
   * resumed. The idle dot is a dimmed GREEN, which on a row in Recent claims
   * something untrue: that there is a process there, resting. A hollow grey
   * ring says "nothing is running here" without implying a fault.
   */
  ended,
  size = 8,
}: {
  busy?: boolean;
  ended?: boolean;
  size?: number;
}) {
  const { colors } = useTheme();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!busy) {
      pulse.value = 1;
      return;
    }
    // Tailwind's `animate-pulse`: 2s, opacity 1 → .5 → 1, ease-in-out.
    pulse.value = withRepeat(withTiming(0.5, { duration: 1000 }), -1, true);
  }, [busy, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: busy ? pulse.value : 1 }));

  return (
    <Reanimated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: ended
            ? "transparent"
            : busy
              ? colors.warning
              : withAlpha(colors.success, 0.3),
          ...(busy
            ? {}
            : {
                borderWidth: 1,
                borderColor: ended
                  ? withAlpha(colors.textMuted, 0.5)
                  : withAlpha(colors.success, 0.2),
              }),
        },
        pulseStyle,
      ]}
    />
  );
}

/** Green when the agent is working, grey when idle, amber when blocked. */
export function StatusDot({
  busy,
  blocked,
  size = 8,
}: {
  busy?: boolean;
  blocked?: boolean;
  size?: number;
}) {
  const { colors } = useTheme();
  const color = blocked ? colors.warning : busy ? colors.busy : colors.textMuted;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        // An idle dot competing with the title for attention is noise; only a
        // live one earns full strength.
        opacity: busy || blocked ? 1 : 0.45,
      }}
    />
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  const { colors, type, space } = useTheme();
  return (
    <Text
      style={{
        ...type.overline,
        color: colors.textMuted,
        textTransform: "uppercase",
        paddingHorizontal: space.lg,
        paddingTop: space.lg,
        paddingBottom: space.sm,
      }}
    >
      {children}
    </Text>
  );
}

/** Grouped-list card, the iOS inset style the web surface also uses. */
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          marginHorizontal: space.lg,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Separator({ inset = 0 }: { inset?: number | "text" }) {
  const { colors, space } = useTheme();
  /**
   * A real iOS grouped-list separator stops under the row's TEXT, not the
   * card edge. "text" models the StatusDot-led row (Row's own padding, the
   * 8pt dot, then its gap) — the shape every current icon-led call site uses
   * — rather than a pixel guess that drifts if Row's spacing ever changes. A
   * row with no leading dot/icon has its text flush with the card padding
   * already, so it passes that padding as a plain number instead.
   */
  const resolvedInset = inset === "text" ? space.lg + 8 + space.md : inset;
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
        marginLeft: resolvedInset,
      }}
    />
  );
}

export function Row({
  children,
  onPress,
  disabled,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const { colors, space } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || !onPress}
      // Small on purpose: the row already has the background swap as its
      // primary pressed cue, and a full-bleed row visibly shrinking against
      // its neighbours in a Card list reads as a glitch, not a press.
      scale={0.98}
      style={({ pressed }) => ({
        // 44pt is the Apple minimum touch target; rows that carry two lines of
        // text clear it on their own, but a single-line row would not.
        minHeight: 44,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        backgroundColor: pressed && onPress ? colors.cardPressed : "transparent",
        opacity: disabled ? 0.5 : 1,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
      })}
    >
      {children}
    </PressableScale>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  const { colors, type, space } = useTheme();
  return (
    <View style={{ alignItems: "center", paddingHorizontal: space.xl, paddingVertical: space.xxl * 2 }}>
      <Text style={{ ...type.headline, color: colors.text, textAlign: "center" }}>{title}</Text>
      {detail ? (
        <Text
          style={{
            ...type.footnote,
            color: colors.textMuted,
            textAlign: "center",
            marginTop: space.sm,
            lineHeight: 19,
          }}
        >
          {detail}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: space.lg }}>{action}</View> : null}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  tone = "primary",
}: {
  label: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: "primary" | "quiet";
}) {
  const { colors, radius, type, space } = useTheme();
  const isQuiet = tone === "quiet";
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      scale={0.97}
      dim={0.85}
      style={{
        height: 50,
        borderRadius: radius.lg,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: space.xl,
        backgroundColor: isQuiet ? colors.secondary : colors.primary,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {loading ? (
        <ActivityIndicator color={isQuiet ? colors.text : colors.primaryForeground} />
      ) : (
        <Text
          style={{
            ...type.headline,
            color: isQuiet ? colors.text : colors.primaryForeground,
          }}
        >
          {label}
        </Text>
      )}
    </PressableScale>
  );
}


/**
 * Which glyph to draw. Either an SF Symbol pair or a Lucide name, never both
 * and never neither — a union rather than three optional props, so a call site
 * cannot compile with no glyph at all.
 *
 * SF Symbols are the default and should stay that way; see omg/lucide.tsx for
 * the narrow case Lucide exists to cover.
 */
export type GlyphProps =
  | { ios: SFSymbol; android: AndroidSymbol; lucide?: never }
  | { lucide: LucideName; ios?: never; android?: never };

/** An SF Symbol on iOS with a Material fallback elsewhere, or a Lucide glyph. */
export function Icon({
  size = 20,
  color,
  weight = "regular",
  ...glyph
}: GlyphProps & {
  size?: number;
  color?: string;
  /**
   * SF Symbols carry their own optical weight, and a symbol next to 17pt
   * semibold text needs to be semibold too or it reads as a different family.
   */
  weight?: SymbolWeight;
}) {
  if (glyph.lucide) return <LucideIcon name={glyph.lucide} size={size} color={color} />;
  return (
    <SymbolView
      name={{ ios: glyph.ios, android: glyph.android, web: glyph.android }}
      size={size}
      weight={weight}
      tintColor={color}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * A tappable SF Symbol on a circular fill — the toolbar button iOS uses in
 * Messages and Mail. 44pt of touch target regardless of how small the glyph is,
 * because the glyph size is a visual choice and the target is an Apple minimum.
 */
export function IconButton({
  onPress,
  disabled,
  size = 18,
  color,
  background,
  accessibilityLabel,
  busy,
  ...glyph
}: GlyphProps & {
  onPress?: () => void;
  disabled?: boolean;
  size?: number;
  color?: string;
  /** Omit for a bare glyph with no disc behind it. */
  background?: string;
  accessibilityLabel: string;
  busy?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || busy}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      // A small glyph-only button can afford a more visible compress than a
      // full card — there's no background/border underneath competing for
      // the eye, so the motion carries the whole "this registered" cue.
      scale={0.88}
      dim={0.55}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: background ?? "transparent",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={color ?? colors.textSecondary} />
      ) : (
        <Icon {...glyph} size={size} color={color ?? colors.textSecondary} />
      )}
    </PressableScale>
  );
}

/**
 * A circular agent mark. The marks carry their own brand colour, so the disc
 * underneath stays neutral and a fleet list is scannable without reading a word.
 */
/**
 * The avatar's default diameter, named because the grouped-list separator is
 * inset to exactly this plus the row's gaps. A literal in two places would
 * drift the day the avatar is resized, and the inset would silently stop
 * lining up with the title.
 */
export const AVATAR_SIZE = 40;

export function AgentAvatar({
  agent,
  size = AVATAR_SIZE,
  busy,
  plain,
}: {
  agent?: string | null;
  size?: number;
  /** Draws the working ring around the mark. See below for why a RING. */
  busy?: boolean;
  /**
   * No disc behind the mark. The web draws these marks straight onto the card
   * — they are already circular artwork with their own brand colour, so a grey
   * disc under them just puts a second circle round the first one. The disc
   * stays where the mark sits on GLASS (the composer), which has no card
   * beneath it to sit on.
   */
  plain?: boolean;
}) {
  const { colors } = useTheme();
  const spin = useSharedValue(0);

  useEffect(() => {
    if (!busy) {
      spin.value = 0;
      return;
    }
    spin.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false);
  }, [busy, spin]);

  const ring = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));
  // The marks carry their own brand colour, so the disc underneath stays
  // neutral. Tinting it per agent fought the icon and turned a terracotta
  // asterisk on white into a terracotta asterisk on orange.
  /**
   * A RING AROUND THE MARK while the agent works, the way the web draws it.
   *
   * The row already carries a dot on its trailing edge, but that is a state
   * you read; this is the one the eye catches without being asked. It goes
   * round the mark rather than replacing it, so you can still see WHICH agent
   * is busy — the identity and the activity are two facts, and a spinner that
   * covers the icon throws one away.
   *
   * A single arc on a rotating border, not an ActivityIndicator: the system
   * spinner cannot be made to hug a 32pt circle, and its grey competes with
   * the amber this state is coloured everywhere else.
   */
  /**
   * THE RING TAKES THE MARK'S FOOTPRINT, and the mark shrinks inside it.
   *
   * Drawing the ring OUTSIDE the mark made a working row's icon visibly bigger
   * than an idle one, so a list with both in it looked ragged — the rows were
   * not the same shape, and the difference read as a layout bug rather than as
   * state. Now `size` is what the whole thing occupies either way: busy just
   * spends 8pt of it on the ring.
   */
  const ringSize = size;
  const markSize = busy ? size - 9 : size;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {busy ? (
        <Reanimated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: ringSize,
              height: ringSize,
              borderRadius: ringSize / 2,
              borderWidth: 2,
              borderColor: "transparent",
              borderTopColor: colors.warning,
              borderRightColor: colors.warning,
            },
            ring,
          ]}
        />
      ) : null}
      <View
        style={{
          width: markSize,
          height: markSize,
          borderRadius: markSize / 2,
          backgroundColor: plain ? "transparent" : colors.secondary,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <Image
          source={agentIcon(agent)}
          // Without a disc the artwork can use the whole box; inside one it has
          // to leave the disc a margin or it reads as a sticker on a coin.
          style={
            plain
              ? { width: markSize, height: markSize }
              : { width: Math.round(markSize * 0.62), height: Math.round(markSize * 0.62) }
          }
          resizeMode="contain"
        />
      </View>
    </View>
  );
}

/**
 * A section header that sits directly on the page background — a small
 * coloured dot, an uppercase label and a count, with an optional quiet action
 * on the right (the web's "Smart clear"). Not a card header: no fill, no
 * border.
 */
export function SectionHeader({
  label,
  count,
  dotColor,
  actionLabel,
  onAction,
}: {
  label: string;
  count?: number;
  dotColor: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors, type, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.lg,
        paddingTop: space.xl,
        paddingBottom: space.sm,
      }}
    >
      {/* 6pt, as on the web (`size-1.5`) — the row dots are 8pt, and a section
          marker that matched them competed with the rows it introduces. */}
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dotColor }} />
      <Text style={{ ...type.overline, color: colors.textMuted, textTransform: "uppercase" }}>
        {label}
      </Text>
      {/* The count is a CHIP, not part of the label. Same as the web: a
          tabular number on the muted surface, so "IDLE 8" does not read as a
          section called "idle 8". */}
      {typeof count === "number" ? (
        <View
          style={{
            paddingHorizontal: 6,
            paddingVertical: 1,
            borderRadius: 999,
            backgroundColor: colors.secondary,
          }}
        >
          <Text
            style={{
              ...type.caption,
              fontSize: 10,
              fontVariant: ["tabular-nums"],
              color: colors.textMuted,
              fontWeight: "500",
            }}
          >
            {count}
          </Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <Text style={{ ...type.subhead, color: colors.primary }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One session as its own CARD, spaced from its neighbours and carrying its own
 * edge — the same shape the web Computer uses.
 *
 * This spent a version as an inset-grouped list (one shared surface, hairline
 * separators, only the group's outer corners rounded) on the argument that
 * separate tiles compete with each other. Seen on the device, the grouped
 * version buried the thing that matters: a session is a separate object with
 * its own agent, its own state and its own swipe-to-archive, and the list is
 * short enough that it was never a scanning problem. Matching the web also
 * means the two surfaces stop describing the same session two ways.
 *
 * Avatar left, one-line title, muted one-line subtitle, state right: a spinner
 * while working, a green dot when idle, a pause glyph when blocked.
 */
export function SessionCard({
  title,
  subtitle,
  agent,
  busy,
  blocked,
  ended,
  onPress,
  onArchive,
}: {
  title: string;
  subtitle?: string | null;
  agent?: string | null;
  busy?: boolean;
  blocked?: boolean;
  /** Finished: no agent attached, resumable. See SessionStatusDot. */
  ended?: boolean;
  onPress: () => void;
  /** Omit to make the row unswipeable — a running session has nothing to archive. */
  onArchive?: () => void;
}) {
  const { colors, radius, type, space, motion } = useTheme();
  // Entering/exiting/layout live on this outer, style-less view rather than
  // folded into PressableScale below: list membership (a card arriving,
  // leaving, or resettling because a sibling did) and press feedback are
  // different concerns with different lifetimes, and PressableScale is
  // reused by four other pressables that have no list to belong to.
  const listMotion = useListItemMotion();

  // The archive backdrop has to match the card it is revealed from, or the red
  // shows past the corners as four sharp ears.
  const corners = { borderRadius: radius.xl };

  /**
   * Swipe-to-archive, on PanResponder rather than react-native-gesture-handler.
   *
   * GH resolves in node_modules as a transitive dependency of
   * expo-router/react-native-screens, but its native module is NOT in this
   * app's binary — checked with `nm` against the installed .app — so importing
   * Swipeable would throw at runtime and could only be fixed by a new
   * TestFlight build. PanResponder is React Native core and rides along in the
   * JS bundle, so this reaches the phone in an over-the-air update. Same
   * reasoning, and the same shape, as the toast's swipe-to-dismiss.
   */
  const translateX = useSharedValue(0);
  const archiveRef = useRef(onArchive);
  archiveRef.current = onArchive;
  const swipeable = !!onArchive;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Only claim a gesture that is clearly HORIZONTAL and leftward. The
        // card sits in a vertical ScrollView, so a responder that took every
        // touch would eat scrolling; requiring dx to beat dy leaves the list
        // scrollable and makes the two gestures unambiguous rather than
        // racing.
        //
        // This MUST be the capture variant. The card's own PressableScale
        // becomes the responder on touch-start, and a responder is only
        // dislodged by an ancestor asking during the CAPTURE phase — the
        // bubbling `onMoveShouldSetPanResponder` is never even consulted once
        // a child holds the gesture. With the bubbling version the swipe was
        // silently dead: every drag was delivered to the Pressable, which does
        // nothing with movement, so the card neither moved nor opened.
        onMoveShouldSetPanResponderCapture: (_evt, gesture) =>
          swipeable && gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderMove: (_evt, gesture) => {
          if (gesture.dx < 0) translateX.value = Math.max(gesture.dx, -REVEAL_WIDTH * 1.4);
        },
        onPanResponderRelease: (_evt, gesture) => {
          const committed =
            gesture.dx < -SWIPE_ARCHIVE_PX || gesture.vx < -SWIPE_ARCHIVE_VELOCITY;
          if (committed) {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Slide the card out under its own exit rather than snapping back
            // and letting the row vanish from a list update: the motion is the
            // confirmation that the swipe did something.
            translateX.value = withTiming(-SCREEN_WIDTH, { duration: motion.fast });
            archiveRef.current?.();
          } else {
            translateX.value = withTiming(0, { duration: motion.quick });
          }
        },
        onPanResponderTerminate: () => {
          translateX.value = withTiming(0, { duration: motion.quick });
        },
      }),
    [swipeable, translateX, motion.fast, motion.quick],
  );

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  // The red behind the card only earns its pixels once the card has moved off
  // them. Tied to travel rather than faded on a timer so it cannot appear
  // under a stationary row.
  const revealStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(translateX.value) / REVEAL_WIDTH),
  }));

  return (
    <Reanimated.View
      entering={listMotion.entering}
      layout={listMotion.layout}
    >
      {swipeable ? (
        <Reanimated.View
          pointerEvents="none"
          style={[
            revealStyle,
            {
              // Written out rather than spreading StyleSheet.absoluteFill,
              // which is a REGISTERED STYLE ID (a number) — spreading it
              // silently contributes nothing, and the reveal would have sat
              // at zero size behind the card.
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: colors.danger,
              ...corners,
              marginHorizontal: space.lg,
              alignItems: "flex-end",
              justifyContent: "center",
              paddingRight: space.xl,
            },
          ]}
        >
          <Icon ios="archivebox.fill" android="archive" size={20} color="#ffffff" />
        </Reanimated.View>
      ) : null}
      <Reanimated.View style={cardStyle} {...(swipeable ? panResponder.panHandlers : {})}>
        <PressableScale
          onPress={onPress}
          scale={0.97}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
            backgroundColor: pressed ? colors.cardPressed : colors.card,
            /**
             * A CARD PER SESSION, not one grouped surface.
             *
             * This was an inset-grouped list — shared surface, hairline
             * separators, only the group's outer corners rounded — on the
             * argument that six tiles read as six competing objects. On the
             * device that argument lost: the web surface spaces its sessions
             * apart and gives each one an edge, and a session IS a separate
             * object (its own agent, its own state, its own swipe-to-archive).
             * The rows now match the web.
             */
            borderRadius: radius.xl,
            // A full point, in the STRONGER border colour. `border` is
            // rgba(84,84,88,.35) and even at 1pt it reads as a rumour against
            // black; `borderStrong` is the same hue at .65 and gives the card
            // an edge you can actually see, which is the point of having one.
            borderWidth: 1,
            borderColor: colors.borderStrong,
            marginHorizontal: space.lg,
            /**
             * The mark needs room to be a mark.
             *
             * This was 12, tuned when the avatar had a disc behind it that did
             * the spacing job on its own. Bare artwork against the card's own
             * edge reads as crowded — the glyph starts where the border ends —
             * and 16 gives it the same breathing room the title has from the
             * text beside it.
             */
            paddingLeft: space.lg,
            // More room on the right than the left: the status dot is a 10pt
            // circle with no visual mass of its own, so an equal inset leaves
            // it looking stuck to the group's edge. The avatar on the left is
            // big enough not to need the same help.
            paddingRight: space.lg,
            paddingVertical: 10,
            minHeight: 60,
          })}
        >
          {/* 22. The mark identifies the agent; it is not the subject of the
              row. Without a disc around it the artwork reads at full size, so
              what used to need 40pt of circle now says the same thing in half
              of that and stops competing with the session's name. */}
          <AgentAvatar agent={agent} size={22} busy={busy} plain />
          <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
            {/* 15/12, down from 17/13. A session's name is a fragment of a
                prompt, not a headline — at 17 a list of eight of them read as
                eight headings, and the extra point bought no legibility on a
                line that truncates anyway. */}
            <Text
              numberOfLines={1}
              style={{ ...type.callout, fontWeight: "600", color: colors.text }}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} style={{ ...type.caption, fontWeight: "400", color: colors.textMuted }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {/* One definition of "is this session working?", shared with the
              web — see SessionStatusDot. A spinner here was louder than the
              web's pulsing dot and in the brand orange rather than warning
              amber, so the two surfaces disagreed about the same session. */}
          {blocked ? (
            <Icon ios="pause.fill" android="pause" size={12} color={colors.warning} />
          ) : (
            <SessionStatusDot busy={busy} ended={ended} />
          )}
        </PressableScale>
      </Reanimated.View>
    </Reanimated.View>
  );
}

/**
 * The home composer, pinned to the bottom of the screen.
 *
 * ONE surface: a floating field holding the agent button, the input, and send.
 * Below it sits a flat caption row of the two things a new session actually
 * needs decided — WHICH AGENT and WHICH FOLDER — as bare glyph+label buttons
 * rather than pills, because they are metadata about the field above and a
 * filled container would promote them to a second competing surface.
 *
 * Both were previously undecidable. The agent was hardcoded to the server
 * default and the folder caption was a LABEL, not a control: it printed the
 * machine's `defaultFolder` and there was no way to run anywhere else. So the
 * app could only ever start one kind of session in one directory, on a product
 * whose entire point is choosing.
 *
 * Send is a send button, not "Start", and it only exists once there is
 * something to send. A permanently visible, permanently dimmed button is a
 * control that reads as broken; the field is self-evidently a thing you type
 * into, so nothing is lost by letting the button arrive with the text.
 *
 * Purely presentational: the screen owns the draft, the choices and the submit.
 */
export function HomeComposer({
  value,
  onChangeText,
  onStart,
  starting,
  projectLabel,
  projectOptions,
  agent,
  agentLabel,
  agentOptions,
  modelLabel,
  modelOptions,
  thinkingLabel,
  thinkingOptions,
  attachments,
  dictation,
  usage = [],
  usageLoading,
  bottomInset = 0,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onStart: () => void;
  starting?: boolean;
  projectLabel?: string | null;
  /** Empty when this machine has one folder — see session-options.ts. */
  projectOptions: MenuOption[];
  agent?: string | null;
  agentLabel?: string | null;
  agentOptions: MenuOption[];
  /** Which model, and how hard to think — each its own one-layer menu. */
  modelLabel?: string | null;
  modelOptions?: MenuOption[];
  thinkingLabel?: string | null;
  thinkingOptions?: MenuOption[];
  /** The files going with this prompt, and how to pick more. */
  attachments: {
    items: Attachment[];
    options: MenuOption[];
    remove: (id: string) => void;
  };
  dictation: {
    state: "idle" | "recording" | "transcribing";
    toggle: () => void;
    /** Throw the current take away instead of sending it. */
    cancel?: () => void;
    /** 0..1 input level, and the live tail — see DictationCaption. */
    level?: number;
    partial?: string;
    live?: boolean;
  };
  /** Rate-limit windows, one ring each. Empty until the machine answers. */
  usage?: ProviderUsage[];
  /** Still asking. Draws a spinner where the rings will be. */
  usageLoading?: boolean;
  bottomInset?: number;
}) {
  const { colors, isDark, radius, type, space } = useTheme();
  /** The not-yet-settled words, when a live take is running. */
  const dictationTail =
    dictation.live && dictation.state === "recording" ? (dictation.partial ?? "").trim() : "";
  const canStart = value.trim().length > 0 && !starting;
  /** Where the finger went down on the mic, so an upward drag can cancel once. */
  const cancelSwipe = useRef<{ y: number; fired: boolean } | null>(null);
  const hairline = {
    borderWidth: isDark ? StyleSheet.hairlineWidth : 0,
    borderColor: colors.borderSoft,
  };
  return (
    <View
      style={{
        paddingHorizontal: space.lg,
        paddingTop: space.sm,
        // The home indicator's inset PLUS a gap, not the larger of the two.
        // `Math.max` let the inset swallow the gap on every device that has
        // one, so the field sat flush against the indicator here while the
        // session composer — which adds them — floated correctly. Two
        // composers, two heights, on screens you swap between constantly.
        paddingBottom: bottomInset + space.sm,
        // Transparent under glass so the blur has content to sample; opaque
        // otherwise so list rows do not show through the composer.
        backgroundColor: LIQUID_GLASS ? "transparent" : colors.bg,
      }}
    >
      {/* Liquid Glass on iOS 26+, a solid card everywhere else. */}
      <GlassSurface
        variant="regular"
        fallbackColor={colors.card}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          borderRadius: radius.pill,
          minHeight: 52,
          paddingLeft: space.sm,
          paddingRight: space.sm,
          overflow: "hidden",
          shadowColor: colors.text,
          shadowOpacity: isDark || LIQUID_GLASS ? 0 : 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
          ...(LIQUID_GLASS ? {} : hairline),
        }}
      >
        {/* The avatar IS the agent picker. It already showed which agent would
            run, so making it the control means the answer and the way to
            change it are the same object, rather than adding a second
            affordance that says the same thing.

            No PressableScale: the menu owns the press (the trigger lives
            inside a SwiftUI Menu, so React Native never sees the touch), and a
            spring that cannot fire is worse than none. The menu's own
            appearance is the feedback. */}
        {/* No affordance badge. A chevron tucked under the avatar was a 14pt
            label explaining a control that opens the moment you touch it —
            the kind of hint that makes an interface look unsure of itself.
            Pressing it teaches it once and for good. */}
        {agentOptions.length ? (
          <DropdownMenu options={agentOptions}>
            <View accessibilityLabel={`Agent: ${agentLabel ?? "Claude"}. Change`}>
              <AgentAvatar agent={agent} size={32} />
            </View>
          </DropdownMenu>
        ) : (
          <AgentAvatar agent={agent} size={32} />
        )}
        <TextInput
          /**
           * THE LIVE TRANSCRIPT GOES IN THE FIELD, not above it.
           *
           * It spent a version as a dimmed caption over the composer, which
           * put the words you were saying somewhere other than the box they
           * were about to become — you watched one place and typed in
           * another. Dictation is typing with your voice, so it belongs in the
           * field, exactly where typed words would be.
           *
           * Committed chunks are already IN `value` (that is what `onText`
           * does); `partial` is only ever the tail the transcriber has not
           * settled yet, so appending it here shows the whole sentence with no
           * double-counting.
           */
          value={dictationTail ? `${value}${value ? " " : ""}${dictationTail}` : value}
          onChangeText={onChangeText}
          /**
           * Not editable mid-take. The field's contents are partly a
           * provisional tail that will be REPLACED when the transcriber
           * settles it, so a keystroke landing in the middle of that would be
           * silently eaten. You are speaking, not typing.
           */
          editable={!dictationTail}
          placeholder="What should we work on?"
          placeholderTextColor={colors.textMuted}
          returnKeyType="send"
          onSubmitEditing={() => {
            if (canStart) onStart();
          }}
          style={{
            flex: 1,
            minWidth: 0,
            color: colors.text,
            ...type.body,
            paddingVertical: space.sm,
          }}
        />
        {/* Attach sits in the field, at the trailing edge, next to the control
            that sends. Both act on the message, so both belong to the box that
            holds it. */}
        <DropdownMenu options={attachments.options} style={{ width: 30, height: 30 }}>
          <View
            accessibilityRole="button"
            accessibilityLabel="Attach a file"
            style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}
          >
            <Icon ios="paperclip" android="attach_file" size={17} color={colors.textMuted} />
          </View>
        </DropdownMenu>

        {/* Dictate until there are words to send, then the same spot sends
            them — the rule the session composer follows. */}
        {!canStart && !starting ? (
          <Pressable
            onPress={dictation.toggle}
            /**
             * THE SAME RECORDING CONTROL AS THE CHAT COMPOSER — meter while
             * listening, hold or swipe up to throw the take away.
             *
             * This screen had the old red stop square long after the session
             * screen stopped using one, so the same act looked like two
             * different features depending which composer you were in.
             */
            onLongPress={dictation.cancel}
            delayLongPress={400}
            onTouchStart={(e) => {
              cancelSwipe.current = { y: e.nativeEvent.pageY, fired: false };
            }}
            onTouchMove={(e) => {
              const swipe = cancelSwipe.current;
              if (!swipe || swipe.fired || dictation.state !== "recording") return;
              if (swipe.y - e.nativeEvent.pageY > 44) {
                swipe.fired = true;
                dictation.cancel?.();
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={
              dictation.state === "recording" ? "Stop and start the session" : "Dictate a prompt"
            }
            accessibilityHint={
              dictation.state === "recording"
                ? "Swipe up or hold to discard this recording"
                : undefined
            }
            style={({ pressed }) => ({
              width: 30,
              height: 30,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {dictation.state === "transcribing" ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : dictation.state === "recording" ? (
              <VoiceMeter level={dictation.level} color={colors.danger} />
            ) : (
              <Icon ios="mic" android="mic" size={17} color={colors.textMuted} />
            )}
          </Pressable>
        ) : null}

        {/* Arrives with the text and leaves with it. Circular and glyph-only:
            the Messages send button, not a labelled call to action. */}
        {canStart || starting ? (
          <PressableScale
            onPress={onStart}
            disabled={!canStart}
            accessibilityLabel="Start session"
            scale={0.94}
            dim={0.8}
            style={{
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.text,
              borderRadius: radius.pill,
              width: 34,
              height: 34,
            }}
          >
            {starting ? (
              <ActivityIndicator size="small" color={colors.bg} />
            ) : (
              <Icon ios="arrow.up" android="arrow_upward" size={16} color={colors.bg} />
            )}
          </PressableScale>
        ) : null}
      </GlassSurface>

      {/* UNDER the box: what the fleet has spent on the left, where the next
          session runs on the right. Both are facts ABOUT the message you are
          composing rather than controls inside it, and giving each a side to
          own beats a queue of pills all starting from the left edge. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: space.sm,
          // Asymmetric on purpose: small rings read better held off the edge,
          // while the folder pill has its own fill and can sit closer to it.
          paddingLeft: space.sm,
          paddingRight: space.xs,
        }}
      >
        {/**
         * ONE AGENT, ONE SET OF RINGS. The composer's question is narrow — "if
         * I send this, is there room?" — and that is the agent about to run,
         * with its accounts folded together (see `mergeByKind`) rather than
         * one circle per login answering a question nobody asked.
         */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {/**
           * THE CAPSULE ARRIVES BEFORE THE NUMBERS DO.
           *
           * Usage is several requests to CLIs that answer at their own pace,
           * so the rings appear seconds after the composer does. Rendering
           * nothing until then made the caption row visibly reflow — and worse,
           * said nothing about whether this machine reports usage at all. A
           * spinner in the same 32pt capsule holds the space and answers the
           * question: something is coming.
           */}
          {usageLoading && !usage.some((p) => p.kind === providerKindForAgent(agent)) ? (
            <GlassSurface
              variant="regular"
              fallbackColor={colors.secondary}
              style={{
                width: 32,
                height: 32,
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              <ActivityIndicator size="small" color={colors.textMuted} />
            </GlassSurface>
          ) : null}
          {usage
            .filter((provider) => provider.kind === providerKindForAgent(agent))
            .map((provider) => (
              /**
               * ON GLASS, like the folder pill opposite it.
               *
               * The web draws these rings bare, and copying that put them
               * straight onto whatever session card happened to be scrolling
               * under the floating composer — plus each ring punches an opaque
               * hole in its middle to fake a stroke, so a black disc sat on top
               * of a card's border. The web can be bare because its composer
               * has an opaque surface behind it; ours does not.
               *
               * A 32pt capsule, the pill's own height, so the caption row reads
               * as two chips rather than one chip and some loose marks.
               *
               * THE RINGS FILL IT, and the chip is sized to the rings rather
               * than the other way round.
               *
               * They started at 24 inside 32 — a quarter of the control spent
               * on padding, and arcs too fine to read. Filling the chip fixed
               * the reading and made the whole thing loud beside the folder
               * pill, so the chip came down twice, to 22 inside 24: a third
               * smaller than where this started, with the rings still doing
               * the reading rather than the padding.
               */
              <GlassSurface
                key={provider.id}
                variant="regular"
                fallbackColor={colors.secondary}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: radius.pill,
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <UsageRings
                  size={22}
                  windows={provider.available ? orderWindows(provider.windows ?? []) : []}
                />
              </GlassSurface>
            ))}
        </View>

        {/**
         * THE THREE THINGS THAT DECIDE THE RUN, each its own control.
         *
         * They used to be one menu with the models nested behind each agent,
         * and nesting cost two things: a submenu row cannot carry a brand mark
         * (UIKit sizes the open submenu's header image itself, which produced
         * an ~80pt slab over the menu), and press-and-drag — hold the control,
         * slide onto a row, release — does not survive a sideways step into a
         * second layer. Separate controls keep every menu one layer deep.
         *
         * Each appears only when there is a choice to make: a box with one
         * model for the current agent does not get a model pill.
         */}
        {/**
         * THE ROW SCROLLS; THE PILLS DO NOT SHRINK.
         *
         * Three controls and a project name do not always fit 393pt, and the
         * flexible row answered that by squeezing each pill until its label
         * truncated — so "gpt-5.6-sol" became "gpt-5.6…" and "All projects"
         * became "All pro…", which is the one thing these controls exist to
         * say. A pill is sized by its content now and the row scrolls when the
         * set is wider than the screen: nothing is ever half-said, and the
         * common case (two short labels) still shows everything at once.
         */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          // Right-aligned when there is room to spare, so the group stays
          // anchored to the folder pill's old edge instead of drifting left.
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 6,
          }}
          style={{ flexShrink: 1 }}
        >
          {modelOptions?.length ? (
            <ComposerCaptionButton
              label={modelLabel ?? "Model"}
              options={modelOptions}
              accessibilityLabel={`Model: ${modelLabel ?? "default"}. Change`}
            />
          ) : null}

          {thinkingOptions?.length ? (
            <ComposerCaptionButton
              ios="brain"
              android="psychology"
              label={thinkingLabel ?? "Thinking"}
              options={thinkingOptions}
              accessibilityLabel={`Thinking: ${thinkingLabel ?? "default"}. Change`}
            />
          ) : null}

          {projectOptions.length ? (
            <ComposerCaptionButton
              ios="folder.fill"
              android="folder"
              label={projectLabel ?? "Project"}
              options={projectOptions}
              accessibilityLabel={`Project: ${projectLabel ?? "none"}. Change`}
            />
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}



/**
 * One control under the composer. The folder is the only one left — the agent
 * moved onto the avatar — but this stays generic rather than being inlined,
 * because "which folder" is not the last decision that will want a pill here.
 *
 * A FILLED PILL, not a caption. This was 13pt muted text with a 10pt chevron
 * and no background: the reasoning was that it is metadata about the field
 * above, so a container would promote it to a competing surface. On a real
 * screen that argument loses. It is the only way to change where the session
 * runs, and rendered as grey fine print it reads as a status line — something
 * the app is telling you, not something you can press. The web composer gets
 * this right with filled pills, and the 44pt touch target the system asks for
 * cannot be honoured by a 13pt line of text either.
 *
 * A quiet fill is enough. It does not compete with the input above, because
 * that is a taller pill with a live caret and a send button in it.
 */
function ComposerCaptionButton({
  ios,
  android,
  label,
  options,
  accessibilityLabel,
}: {
  /** Optional: a model name is a name, and a symbol beside it would be decoration. */
  ios?: SFSymbol;
  android?: AndroidSymbol;
  label: string;
  /** Empty means there is nothing to choose; the pill stays, unpressable. */
  options: MenuOption[];
  accessibilityLabel: string;
}) {
  const { colors, radius, type, space } = useTheme();
  /**
   * THE MEASUREMENT IS TAGGED WITH THE LABEL IT WAS TAKEN FOR.
   *
   * This used to be a bare `{width, height}` plus `useEffect(() => setSize(null),
   * [label])` to invalidate it. That is one frame too late, and it is why the
   * pill visibly clipped when a project name got LONGER:
   *
   *   frame N    label is the new long one, but the effect has not run yet, so
   *              the Host is still pinned to the SHORT label's width. The pill
   *              is `overflow: hidden` with `numberOfLines={1}`, so the new
   *              label renders clipped inside the old box. <- the reported bug
   *   frame N+1  the effect has now fired, size is null, the pill measures
   *              unconstrained.
   *   frame N+2  the new width is applied and it finally looks right.
   *
   * Short-to-long clipped the text; long-to-short only looked a little roomy
   * for a frame, which is why only one direction was ever noticed.
   *
   * Tagging fixes it by construction rather than by timing: a measurement
   * carries the label it describes, and the width is only applied when that
   * tag still matches. A stale width is now *unapplicable* instead of merely
   * scheduled for deletion, so frame N constrains nothing and the pill is
   * drawn at its natural size immediately. No effect, and no setState during
   * render either.
   */
  const [measured, setMeasured] = useState<{
    label: string;
    width: number;
    height: number;
  } | null>(null);
  const size = measured && measured.label === label ? measured : null;
  // Glass, like the field it captions and the buttons inside it. A flat fill
  // here was the last piece of chrome on this screen made of something else.
  const pill = (
    <GlassSurface
      variant="regular"
      fallbackColor={colors.secondary}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        // 32pt tall, and the menu's trigger area is the pill itself.
        minHeight: 32,
        /**
         * TIGHT TO THE LABEL. At 14 each side a four-letter model name wore
         * more padding than text, and three of these in a row read as three
         * empty capsules with words parked in them. 9 is enough to keep the
         * glass off the glyphs and no more — the pill is meant to be the size
         * of what it says.
         */
        paddingHorizontal: 9,
        borderRadius: radius.pill,
        // Sized by its label, full stop. The row it lives in scrolls, so
        // there is nothing to give way for — and giving way meant truncating
        // the only thing the control says.
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      {/* 15, not 13. At 13 the folder read as a bullet point next to its own
          label — a glyph that small stops being recognisable as a folder and
          becomes texture. */}
      {ios && android ? (
        <Icon ios={ios} android={android} size={15} color={colors.textSecondary} />
      ) : null}
      <Text
        numberOfLines={1}
        /**
         * THE PILL HUGS ITS LABEL.
         *
         * `maxWidth: 130` truncated every project whose name ran past about
         * fourteen characters — "lfg-worktrees…" — so the control that exists
         * to say WHERE the next session runs frequently could not finish
         * saying it, while empty space sat to its left. It grows with the name
         * now; the cap is the width of the row, so a pathological name still
         * cannot push the rings off the screen.
         */
        style={{ ...type.footnote, fontWeight: "500", color: colors.text }}
      >
        {label}
      </Text>
    </GlassSurface>
  );
  if (!options.length) return pill;
  /**
   * THE MENU HOST HAS TO BE TOLD THE PILL'S SIZE — and then told again when
   * the label changes.
   *
   * `DropdownMenu` mounts a SwiftUI `Host` around its trigger, and `Host`'s
   * `matchContents` does not reliably size to React Native content hosted back
   * inside it. So the pill is measured and the measurement handed to the Host,
   * which is what stopped these controls from wearing a box wider than their
   * own glass.
   *
   * That fix then FROZE them, which is the bug this comment exists for. The
   * measured View lives INSIDE the sized Host, so once a width was applied the
   * child was constrained to it, `onLayout` reported that same width forever,
   * and switching to a shorter project name left the pill at the old size. A
   * measurement taken inside the thing it determines is a loop.
   *
   * Two things break it. The measured View is `flex-start`, so it takes its
   * NATURAL width rather than filling whatever the Host currently is — a
   * shorter label measures shorter even while the Host is still wide. And the
   * cached size is dropped whenever the label changes, so the next layout pass
   * starts unconstrained instead of converging down from the old value.
   */
  return (
    <DropdownMenu
      options={options}
      style={size ? { width: size.width, height: size.height } : undefined}
    >
      <View
        style={{ alignSelf: "flex-start" }}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          // Only on a real change: setting state from onLayout with the same
          // numbers is a re-render loop. The label is part of that comparison
          // now, so a measurement taken for a previous label can never satisfy
          // it and linger.
          setMeasured((current) =>
            current &&
            current.label === label &&
            Math.abs(current.width - width) < 0.5 &&
            Math.abs(current.height - height) < 0.5
              ? current
              : { label, width, height },
          );
        }}
      >
        {pill}
      </View>
    </DropdownMenu>
  );
}

/**
 * WHAT RECORDING LOOKS LIKE: your own voice, moving.
 *
 * The recording state used to be a red stop button — the loudest object in the
 * composer, and a control that says "this is a thing you must now cancel"
 * rather than "I am listening". The web shows a level, and a level is the only
 * honest answer to the question people actually have while they talk, which is
 * whether the microphone is hearing them at all. Tapping it still stops; the
 * whole meter is the target.
 *
 * Three bars, centre tallest, all driven by one amplitude. At rest they sit at
 * a visible minimum so the control still reads as present in a silent room —
 * and so it degrades to something sensible on a build whose dictation hook
 * does not report a level yet.
 */
export function VoiceMeter({ level, color }: { level?: number; color: string }) {
  const amplitude = useSharedValue(0);

  useEffect(() => {
    // Fast up, slow down: the shape every level meter uses, because a bar that
    // falls as fast as it rises reads as flicker rather than as a voice.
    const next = Math.max(0, Math.min(1, level ?? 0));
    amplitude.value = withTiming(next, {
      duration: next > amplitude.value ? 70 : 190,
    });
  }, [level, amplitude]);

  // Three explicit hooks rather than one called in a loop: hooks in a helper
  // are a lint error waiting to become a real one the day the bar count is
  // conditional.
  const left = useAnimatedStyle(() => ({ height: 5 + amplitude.value * 15 * 0.7 }));
  const middle = useAnimatedStyle(() => ({ height: 5 + amplitude.value * 15 }));
  const right = useAnimatedStyle(() => ({ height: 5 + amplitude.value * 15 * 0.55 }));
  const bar = { width: 3, borderRadius: 2, backgroundColor: color };

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2.5 }}>
      <Reanimated.View style={[bar, left]} />
      <Reanimated.View style={[bar, middle]} />
      <Reanimated.View style={[bar, right]} />
    </View>
  );
}

/**
 * The files waiting to go with the next message.
 *
 * Thumbnails, not filenames: someone who just picked three screenshots knows
 * them by what they look like, and `IMG_4021.PNG` identifies nothing. The strip
 * only exists while something is attached, so the composer keeps its height in
 * the common case.
 *
 * An upload in flight dims its thumbnail and shows a spinner over it; one that
 * failed goes red and stays put, because a row that removes itself is a row
 * you cannot retry.
 */
export function AttachmentStrip({
  items,
  onRemove,
}: {
  items: Attachment[];
  onRemove: (id: string) => void;
}) {
  const { colors, radius, space } = useTheme();
  if (!items.length) return null;
  return (
    <View style={{ flexDirection: "row", gap: space.sm, paddingBottom: space.sm }}>
      {items.map((item) => (
        <View key={item.id}>
          <Image
            source={{ uri: item.uri }}
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.md,
              opacity: item.path ? 1 : 0.5,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: item.failed ? colors.danger : colors.border,
            }}
          />
          {!item.path && !item.failed ? (
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ActivityIndicator size="small" color={colors.text} />
            </View>
          ) : null}
          {/* The remove target is deliberately bigger than the glyph: it sits
              on a 56pt thumbnail, and a 12pt cross would be unhittable. */}
          <Pressable
            onPress={() => onRemove(item.id)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name}`}
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              width: 22,
              height: 22,
              borderRadius: 11,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.card,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.borderStrong,
            }}
          >
            <Icon ios="xmark" android="close" size={10} color={colors.textSecondary} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

/**
 * Apple-Watch-style rings: ONE PER LIMIT WINDOW, concentric.
 *
 * Claude has two (five-hour and weekly) and Codex has its own; showing only
 * the fullest of them threw away the more interesting half of the answer,
 * because "fine for the next few hours but nearly out for the week" and its
 * opposite are different situations and the single arc drew them identically.
 * Weekly sits outermost, matching the web (see `activityRingOrder`), and the
 * colours are the web's palette so one agent's rings read the same on both
 * surfaces.
 *
 * NO SVG — `react-native-svg` is a native module and this is a decoration.
 * Each ring is a track (a bordered circle) plus an arc built from two rotated
 * half-discs, the way CSS drew these before conic gradients, with a hole
 * punched through so the next ring in shows.
 */
const RING_COLORS = ["#fb923c", "#38bdf8", "#a78bfa", "#34d399"];

export function UsageRings({
  windows,
  size = 24,
}: {
  windows: UsageWindow[];
  size?: number;
}) {
  const { colors } = useTheme();
  const shown = windows.slice(0, RING_COLORS.length);
  // 3 at this diameter: the arcs have to stay distinguishable from each other
  // at 22pt, and a 3.5 stroke on a 22pt circle leaves the inner ring almost no
  // room to exist.
  const thickness = 3;
  const gap = thickness + 1;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {shown.map((window, index) => (
        <Arc
          key={window.label}
          diameter={size - index * gap * 2}
          thickness={thickness}
          pct={window.pct}
          color={RING_COLORS[index % RING_COLORS.length]}
          holeColor={colors.bg}
        />
      ))}
    </View>
  );
}

function Arc({
  diameter,
  thickness,
  pct,
  color,
  holeColor,
}: {
  diameter: number;
  thickness: number;
  pct: number | null;
  color: string;
  holeColor: string;
}) {
  if (diameter <= thickness * 2) return null;
  const angle = Math.min(100, Math.max(0, pct ?? 0)) * 3.6;
  const half = diameter / 2;
  const hole = diameter - thickness * 2;

  const Wedge = ({ rotate, side }: { rotate: number; side: "left" | "right" }) => (
    <View
      style={{
        position: "absolute",
        width: half,
        height: diameter,
        overflow: "hidden",
        [side]: 0,
      }}
    >
      <View
        style={{
          position: "absolute",
          width: half,
          height: diameter,
          [side === "right" ? "left" : "right"]: 0,
          borderTopRightRadius: side === "right" ? half : 0,
          borderBottomRightRadius: side === "right" ? half : 0,
          borderTopLeftRadius: side === "left" ? half : 0,
          borderBottomLeftRadius: side === "left" ? half : 0,
          backgroundColor: color,
          transform: [
            { translateX: side === "right" ? -half / 2 : half / 2 },
            { rotate: `${rotate}deg` },
            { translateX: side === "right" ? half / 2 : -half / 2 },
          ],
        }}
      />
    </View>
  );

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: diameter,
        height: diameter,
        borderRadius: half,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* The track: the same colour, faint, so an empty window still reads as
          a window rather than as nothing being there. */}
      <View
        style={{
          position: "absolute",
          width: diameter,
          height: diameter,
          borderRadius: half,
          borderWidth: thickness,
          borderColor: color,
          opacity: 0.2,
        }}
      />
      {pct !== null ? (
        <>
          <Wedge side="right" rotate={Math.min(angle, 180) - 180} />
          {angle > 180 ? <Wedge side="left" rotate={angle - 360} /> : null}
        </>
      ) : null}
      <View
        style={{
          width: hole,
          height: hole,
          borderRadius: hole / 2,
          backgroundColor: holeColor,
        }}
      />
    </View>
  );
}


/**
 * One provider's rate-limit window, as a ring.
 *
 * NO SVG IN THIS APP — `react-native-svg` is a native module and the whole
 * point of the last few builds has been to avoid adding one for a decoration.
 * So the arc is drawn the way CSS did it before conic gradients: two half-disc
 * masks, each rotated, with a hole punched in the middle. The right half
 * carries the first 180°, the left half the rest.
 *
 * An unavailable provider draws its track and no arc. That is deliberately
 * different from 0%: "we could not ask" and "you have used none of it" look
 * nothing alike once you are close to a limit.
 */
export function UsageRing({
  pct,
  size = 22,
  color,
  children,
}: {
  pct: number | null;
  size?: number;
  color: string;
  /** Drawn in the hole — the agent's mark, at ring scale. */
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const angle = pct === null ? 0 : Math.min(100, Math.max(0, pct)) * 3.6;
  const half = size / 2;
  const hole = size - 5;

  const Wedge = ({ rotate, clip }: { rotate: number; clip: "left" | "right" }) => (
    <View
      style={{
        position: "absolute",
        width: half,
        height: size,
        overflow: "hidden",
        [clip === "right" ? "right" : "left"]: 0,
      }}
    >
      <View
        style={{
          position: "absolute",
          width: half,
          height: size,
          [clip === "right" ? "left" : "right"]: 0,
          borderTopRightRadius: clip === "right" ? half : 0,
          borderBottomRightRadius: clip === "right" ? half : 0,
          borderTopLeftRadius: clip === "left" ? half : 0,
          borderBottomLeftRadius: clip === "left" ? half : 0,
          backgroundColor: color,
          transform: [
            { translateX: clip === "right" ? -half / 2 : half / 2 },
            { rotate: `${rotate}deg` },
            { translateX: clip === "right" ? half / 2 : -half / 2 },
          ],
        }}
      />
    </View>
  );

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: half,
        backgroundColor: colors.secondary,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {pct !== null ? (
        <>
          <Wedge clip="right" rotate={Math.min(angle, 180) - 180} />
          {angle > 180 ? <Wedge clip="left" rotate={angle - 360} /> : null}
        </>
      ) : null}
      <View
        style={{
          width: hole,
          height: hole,
          borderRadius: hole / 2,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
}
