/**
 * Presentational pieces shared by the list screens. No data fetching here —
 * these take what they render, so a screen stays the only place that knows
 * where state comes from.
 */

import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { Text, TextInput } from "./omg/text";
import {
  SymbolView,
  type AndroidSymbol,
  type SFSymbol,
  type SymbolWeight,
} from "expo-symbols";

import { agentIcon } from "./omg/agent-icons";
import { GlassSurface, LIQUID_GLASS } from "./omg/glass";
import { useTheme } from "./omg/theme";

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

export function Separator({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: colors.border,
        marginLeft: inset,
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
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
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
    </Pressable>
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
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        height: 50,
        borderRadius: radius.lg,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: space.xl,
        backgroundColor: isQuiet ? colors.secondary : colors.primary,
        opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
      })}
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
    </Pressable>
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
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: background ?? "transparent",
        opacity: disabled ? 0.35 : pressed ? 0.55 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={color ?? colors.textSecondary} />
      ) : (
        <Icon ios={ios} android={android} size={size} color={color ?? colors.textSecondary} />
      )}
    </Pressable>
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
}: {
  title: string;
  subtitle?: string | null;
  agent?: string | null;
  busy?: boolean;
  blocked?: boolean;
  onPress: () => void;
}) {
  const { colors, isDark, radius, type, space } = useTheme();
  return (
    <Pressable
      onPress={onPress}
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
    </Pressable>
  );
}

/**
 * The home composer, pinned to the bottom of the screen: a pill input with the
 * agent's avatar, above a toolbar row carrying the project chip and Start.
 * Start is ink, not orange — brand orange belongs to the mark and the working
 * dot only.
 *
 * It used to also carry stash, attach and dictate buttons. None of the three
 * was ever wired to anything: the screen rendered them without handlers, so all
 * three were tap-and-nothing-happens. A dictate button is the least defensible
 * of the three — the iOS keyboard already has one, and ours did less.
 *
 * Purely presentational: the screen owns the draft and the submit.
 */
export function HomeComposer({
  value,
  onChangeText,
  onStart,
  starting,
  projectLabel,
  agent,
  bottomInset = 0,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onStart: () => void;
  starting?: boolean;
  projectLabel?: string | null;
  agent?: string | null;
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
      {/* Liquid Glass on iOS 26+, a solid card everywhere else. The composer
          floats over scrolling content, which is exactly the case Apple's
          glass is for — and GlassSurface keeps a real background underneath so
          older systems get a card rather than a transparent hole. */}
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
          paddingRight: space.xs,
          overflow: "hidden",
          shadowColor: colors.text,
          shadowOpacity: isDark || LIQUID_GLASS ? 0 : 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
          ...(LIQUID_GLASS ? {} : hairline),
        }}
      >
        <AgentAvatar agent={agent} size={32} />
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
            paddingRight: space.sm,
          }}
        />
      </GlassSurface>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          marginTop: space.md,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            backgroundColor: colors.card,
            borderRadius: radius.pill,
            height: 34,
            paddingHorizontal: space.md,
            ...hairline,
          }}
        >
          <Icon ios="folder.fill" android="folder" size={14} color={colors.textSecondary} />
          <Text
            numberOfLines={1}
            style={{ ...type.footnote, color: colors.textSecondary, maxWidth: 140 }}
          >
            {projectLabel ?? "Project"}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={onStart}
          disabled={!canStart}
          accessibilityLabel="Start session"
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            backgroundColor: colors.text,
            borderRadius: radius.pill,
            height: 40,
            paddingHorizontal: space.lg,
            opacity: !canStart ? 0.35 : pressed ? 0.8 : 1,
          })}
        >
          {starting ? (
            <ActivityIndicator size="small" color={colors.bg} />
          ) : (
            <>
              <Text style={{ ...type.subhead, fontWeight: "600", color: colors.bg }}>Start</Text>
              <Icon ios="arrow.up" android="arrow_upward" size={14} color={colors.bg} />
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}
