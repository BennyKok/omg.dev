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
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { useEffect, useMemo, useRef } from "react";
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
import { peakPct, providerKindForAgent, type ProviderUsage } from "./omg/usage";
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
  size = 8,
}: {
  busy?: boolean;
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
          backgroundColor: busy ? colors.warning : withAlpha(colors.success, 0.3),
          ...(busy
            ? {}
            : { borderWidth: 1, borderColor: withAlpha(colors.success, 0.2) }),
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
  const ringSize = size + 8;
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
          width: size,
          height: size,
          borderRadius: size / 2,
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
              ? { width: size, height: size }
              : { width: Math.round(size * 0.62), height: Math.round(size * 0.62) }
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
  onPress,
  onArchive,
}: {
  title: string;
  subtitle?: string | null;
  agent?: string | null;
  busy?: boolean;
  blocked?: boolean;
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
      exiting={listMotion.exiting}
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
            // Tighter than the old card's uniform 16pt. A grouped row is sized
            // by its content and the 44pt minimum touch target, not by padding
            // holding an isolated tile apart from its neighbours.
            paddingLeft: space.md,
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
            <Text numberOfLines={1} style={{ ...type.headline, color: colors.text }}>
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} style={{ ...type.footnote, color: colors.textMuted }}>
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
            <SessionStatusDot busy={busy} />
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
  attachments,
  dictation,
  usage = [],
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
  /** The files going with this prompt, and how to pick more. */
  attachments: {
    items: Attachment[];
    options: MenuOption[];
    remove: (id: string) => void;
  };
  dictation: { state: "idle" | "recording" | "transcribing"; toggle: () => void };
  /** Rate-limit windows, one ring each. Empty until the machine answers. */
  usage?: ProviderUsage[];
  bottomInset?: number;
}) {
  const { colors, isDark, radius, type, space } = useTheme();
  const canStart = value.trim().length > 0 && !starting;
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
          value={value}
          onChangeText={onChangeText}
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
            accessibilityRole="button"
            accessibilityLabel={
              dictation.state === "recording" ? "Stop dictating" : "Dictate a prompt"
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
            ) : (
              <Icon
                ios={dictation.state === "recording" ? "stop.circle.fill" : "mic"}
                android={dictation.state === "recording" ? "stop_circle" : "mic"}
                size={17}
                color={dictation.state === "recording" ? colors.danger : colors.textMuted}
              />
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
        {/* ONLY THE AGENT THAT WILL RUN THIS. Six rings said what the whole
            fleet had spent, which is a dashboard; the composer's question is
            narrower — "if I send this, is there room?" — and that is one
            agent's window. Several rings can still appear for it when the box
            has more than one account of that kind, which is the honest answer
            to the same question. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {usage
            .filter((provider) => provider.kind === providerKindForAgent(agent))
            .map((provider) => (
              <UsageRing
                key={provider.id}
                pct={provider.available ? peakPct(provider) : null}
                color={ringColor(provider.available ? peakPct(provider) : null, colors)}
              >
                <Image
                  source={agentIcon(provider.kind)}
                  style={{ width: 11, height: 11 }}
                  resizeMode="contain"
                />
              </UsageRing>
            ))}
        </View>

        {projectOptions.length ? (
          <ComposerCaptionButton
            ios="folder.fill"
            android="folder"
            label={projectLabel ?? "Project"}
            options={projectOptions}
            accessibilityLabel={`Project: ${projectLabel ?? "none"}. Change`}
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * A ring runs green until the window is worth knowing about, then amber, then
 * red — the three states the rest of the app already uses for
 * fine / attention / stop. One brand colour would have made 12% and 95% look
 * equally worth reading.
 */
function ringColor(pct: number | null, colors: OmgColors): string {
  if (pct === null) return colors.border;
  if (pct >= 90) return colors.danger;
  if (pct >= 70) return colors.warning;
  return colors.success;
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
  ios: SFSymbol;
  android: AndroidSymbol;
  label: string;
  /** Empty means there is nothing to choose; the pill stays, unpressable. */
  options: MenuOption[];
  accessibilityLabel: string;
}) {
  const { colors, radius, type, space } = useTheme();
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
        paddingHorizontal: space.md - 2,
        borderRadius: radius.pill,
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <Icon ios={ios} android={android} size={13} color={colors.textSecondary} />
      <Text
        numberOfLines={1}
        // Readable weight, not fine print: this is a control's label.
        style={{ ...type.footnote, fontWeight: "500", color: colors.text, maxWidth: 130 }}
      >
        {label}
      </Text>
    </GlassSurface>
  );
  if (!options.length) return pill;
  return <DropdownMenu options={options}>{pill}</DropdownMenu>;
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
