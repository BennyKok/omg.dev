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
import { useMemo, useRef } from "react";
import * as Haptics from "expo-haptics";
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
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
import { GlassSurface, LIQUID_GLASS } from "./omg/glass";
import { PressableScale, useListItemMotion } from "./omg/motion";
import { useTheme } from "./omg/theme";

/** Leftward drag past this, or a fast enough flick, archives the row. */
const SWIPE_ARCHIVE_PX = 96;
const SWIPE_ARCHIVE_VELOCITY = 0.5;
/** How far the card travels before the red behind it is at full strength. */
const REVEAL_WIDTH = 96;
const SCREEN_WIDTH = Dimensions.get("window").width;

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


/** An SF Symbol on iOS with a Material fallback elsewhere. */
export function Icon({
  ios,
  android,
  size = 20,
  color,
  weight = "regular",
}: {
  ios: SFSymbol;
  android: AndroidSymbol;
  size?: number;
  color?: string;
  /**
   * SF Symbols carry their own optical weight, and a symbol next to 17pt
   * semibold text needs to be semibold too or it reads as a different family.
   */
  weight?: SymbolWeight;
}) {
  return (
    <SymbolView
      name={{ ios, android, web: android }}
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
  ios,
  android,
  onPress,
  disabled,
  size = 18,
  color,
  background,
  accessibilityLabel,
  busy,
}: {
  ios: SFSymbol;
  android: AndroidSymbol;
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
        <Icon ios={ios} android={android} size={size} color={color ?? colors.textSecondary} />
      )}
    </PressableScale>
  );
}

/**
 * A circular agent mark. The marks carry their own brand colour, so the disc
 * underneath stays neutral and a fleet list is scannable without reading a word.
 */
export function AgentAvatar({
  agent,
  size = 40,
}: {
  agent?: string | null;
  size?: number;
}) {
  const { colors } = useTheme();
  // The marks carry their own brand colour, so the disc underneath stays
  // neutral. Tinting it per agent fought the icon and turned a terracotta
  // asterisk on white into a terracotta asterisk on orange.
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.secondary,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <Image
        source={agentIcon(agent)}
        style={{ width: Math.round(size * 0.62), height: Math.round(size * 0.62) }}
        resizeMode="contain"
      />
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
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
      <Text style={{ ...type.overline, color: colors.textMuted, textTransform: "uppercase" }}>
        {label}
        {typeof count === "number" ? ` ${count}` : ""}
      </Text>
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
 * One session as its own card — individually rounded, floating on the page
 * with a soft shadow and air between cards, the way the web Computer renders
 * them. Avatar left, bold one-line title, muted one-line subtitle, and the
 * status dot on the RIGHT edge: brand orange while working, green when idle,
 * a pause glyph when blocked.
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
  const { colors, isDark, radius, type, space, motion } = useTheme();
  // Entering/exiting/layout live on this outer, style-less view rather than
  // folded into PressableScale below: list membership (a card arriving,
  // leaving, or resettling because a sibling did) and press feedback are
  // different concerns with different lifetimes, and PressableScale is
  // reused by four other pressables that have no list to belong to.
  const listMotion = useListItemMotion();

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
              borderRadius: radius.xl,
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
            borderRadius: radius.xl,
            marginHorizontal: space.lg,
            padding: space.lg,
            // Shadows are invisible on a black page; dark mode gets a hairline
            // instead so the card still reads as a surface.
            shadowColor: colors.text,
            shadowOpacity: isDark ? 0 : 0.06,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 2 },
            elevation: 1,
            borderWidth: isDark ? StyleSheet.hairlineWidth : 0,
            borderColor: colors.borderSoft,
          })}
        >
          <AgentAvatar agent={agent} />
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ ...type.headline, color: colors.text }}>
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} style={{ ...type.footnote, color: colors.textMuted }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {blocked ? (
            <Icon ios="pause.fill" android="pause" size={12} color={colors.warning} />
          ) : (
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: busy ? colors.brand : colors.success,
              }}
            />
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
  onPickProject,
  agent,
  agentLabel,
  onPickAgent,
  bottomInset = 0,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onStart: () => void;
  starting?: boolean;
  projectLabel?: string | null;
  onPickProject?: () => void;
  agent?: string | null;
  agentLabel?: string | null;
  onPickAgent?: () => void;
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
        paddingBottom: Math.max(bottomInset, space.sm),
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
            affordance that says the same thing. */}
        <PressableScale
          onPress={onPickAgent}
          disabled={!onPickAgent}
          scale={0.9}
          accessibilityRole="button"
          accessibilityLabel={`Agent: ${agentLabel ?? "Claude"}. Change`}
        >
          <AgentAvatar agent={agent} size={32} />
        </PressableScale>
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

      {/* Agent and folder as flat captions. No fill, no hairline, no fixed
          height — they answer "what will run this, and where", which is
          metadata about the field above. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.lg,
          marginTop: space.sm,
          marginLeft: space.xs,
        }}
      >
        <ComposerCaptionButton
          ios="cpu"
          android="memory"
          label={agentLabel ?? "Claude"}
          onPress={onPickAgent}
          accessibilityLabel={`Agent: ${agentLabel ?? "Claude"}. Change`}
        />
        <ComposerCaptionButton
          ios="folder.fill"
          android="folder"
          label={projectLabel ?? "Project"}
          onPress={onPickProject}
          accessibilityLabel={`Project: ${projectLabel ?? "none"}. Change`}
        />
      </View>
    </View>
  );
}

/**
 * One caption-weight control under the composer. Shared by the agent and the
 * folder so the two cannot drift into looking like different kinds of thing —
 * they are the same kind of decision and read as one row.
 */
function ComposerCaptionButton({
  ios,
  android,
  label,
  onPress,
  accessibilityLabel,
}: {
  ios: SFSymbol;
  android: AndroidSymbol;
  label: string;
  onPress?: () => void;
  accessibilityLabel: string;
}) {
  const { colors, type, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        opacity: pressed ? 0.5 : 1,
        minWidth: 0,
      })}
    >
      <Icon ios={ios} android={android} size={13} color={colors.textMuted} />
      <Text
        numberOfLines={1}
        style={{ ...type.footnote, color: colors.textMuted, maxWidth: 130 }}
      >
        {label}
      </Text>
      {onPress ? (
        <Icon ios="chevron.up.chevron.down" android="unfold_more" size={10} color={colors.textMuted} />
      ) : null}
    </Pressable>
  );
}
