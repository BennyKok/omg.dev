/**
 * Presentational pieces shared by the list screens. No data fetching here —
 * these take what they render, so a screen stays the only place that knows
 * where state comes from.
 */

import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { Text, TextInput } from "./omg/text";
import { SymbolView, type AndroidSymbol, type SFSymbol } from "expo-symbols";

import { useTheme } from "./omg/theme";
import { relativeTime } from "./omg/format";

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

/**
 * One session in the list. Deliberately two lines: a title people recognise and
 * a quiet metadata line, with the live dot and the time doing the scanning
 * work.
 */
export function SessionRow({
  title,
  subtitle,
  agent,
  busy,
  blocked,
  lastActivityAt,
  onPress,
}: {
  title: string;
  subtitle?: string | null;
  agent?: string | null;
  busy?: boolean;
  blocked?: boolean;
  lastActivityAt?: number | null;
  onPress: () => void;
}) {
  const { colors, type, space } = useTheme();
  return (
    <Row onPress={onPress}>
      <StatusDot busy={busy} blocked={blocked} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ ...type.callout, color: colors.text, fontWeight: "600" }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ ...type.footnote, color: colors.textMuted }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text style={{ ...type.caption, color: colors.textMuted }}>
          {relativeTime(lastActivityAt)}
        </Text>
        {agent ? (
          <Text style={{ ...type.caption, color: colors.textMuted, opacity: 0.7 }}>{agent}</Text>
        ) : null}
      </View>
    </Row>
  );
}

/**
 * One glyph, two platforms: SF Symbols on iOS, the mapped Material Symbol
 * everywhere else — the same pairing NativeTabs already uses for the tab bar,
 * so the chrome and the content speak one icon language.
 */
export function Icon({
  ios,
  android,
  size = 20,
  color,
}: {
  ios: SFSymbol;
  android: AndroidSymbol;
  size?: number;
  color?: string;
}) {
  return (
    <SymbolView
      name={{ ios, android, web: android }}
      size={size}
      tintColor={color}
      style={{ width: size, height: size }}
    />
  );
}

/** Theme colour keys an avatar is allowed to wear. */
type AvatarColor =
  | "brand"
  | "text"
  | "textSecondary"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";

/**
 * The well-known marks. claude gets the orange asterisk and codex the ink
 * disc because that is what the web surface shows; the rest take a token hue
 * and a letter.
 */
const KNOWN_AGENT_MARKS: Record<
  string,
  { bg: AvatarColor; glyph?: string; sf?: SFSymbol; android?: AndroidSymbol }
> = {
  // SF Symbols, not characters. The first version used U+2733 (\u2733) for the
  // asterisk agents, and iOS gives that codepoint EMOJI presentation by
  // default — so a plain orange disc rendered as a green emoji tile inside an
  // orange circle, a badge inside a badge. Any glyph left below is ASCII or a
  // letter, which can never take an emoji form.
  aisdk: { bg: "brand", sf: "sparkle", android: "auto_awesome" },
  claude: { bg: "brand", sf: "sparkle", android: "auto_awesome" },
  codex: { bg: "text", glyph: "C" },
  "codex-aisdk": { bg: "text", glyph: "C" },
  grok: { bg: "primary", glyph: "G" },
  cursor: { bg: "warning", sf: "cursorarrow", android: "ads_click" },
  opencode: { bg: "success", glyph: "O" },
  jcode: { bg: "textSecondary", glyph: "J" },
  pi: { bg: "danger", glyph: "P" },
  copilot: { bg: "info", sf: "square.on.square", android: "content_copy" },
};

const FALLBACK_AVATAR_COLORS: AvatarColor[] = [
  "primary",
  "success",
  "warning",
  "danger",
  "info",
  "brand",
];

function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/**
 * A circular agent mark. The same agent name always lands on the same colour
 * and glyph, so a fleet list is scannable without reading a word. Hues come
 * from the theme tokens — the avatar palette is the status palette, never a
 * hardcoded hex.
 */
export function AgentAvatar({
  agent,
  size = 40,
}: {
  agent?: string | null;
  size?: number;
}) {
  const { colors } = useTheme();
  const key = (agent ?? "").trim().toLowerCase();
  const known = KNOWN_AGENT_MARKS[key];
  const bgKey =
    known?.bg ?? FALLBACK_AVATAR_COLORS[stableHash(key || "?") % FALLBACK_AVATAR_COLORS.length];
  const glyph = known?.glyph ?? (key ? key[0].toUpperCase() : "•");
  // A dark disc wants the page colour as its glyph; a saturated disc wants
  // white. Anything else is a contrast accident waiting for dark mode.
  const fg = bgKey === "text" || bgKey === "textSecondary" ? colors.bg : colors.primaryForeground;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors[bgKey],
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {known?.sf ? (
        <SymbolView
          name={{ ios: known.sf, android: known.android ?? "circle", web: "circle" }}
          size={Math.round(size * 0.5)}
          tintColor={fg}
          style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }}
        />
      ) : (
        <Text style={{ color: fg, fontSize: Math.round(size * 0.42), fontWeight: "700" }}>
          {glyph}
        </Text>
      )}
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
 * The home composer, pinned to the bottom of the screen: a pill input with
 * the agent's avatar and a dictate button, above a toolbar row (stash, the
 * project chip, attach, and the Start button). Start is ink, not orange —
 * brand orange belongs to the mark and the working dot only.
 *
 * Purely presentational: the screen owns the draft, the submit, and whatever
 * stash/attach/dictate eventually do.
 */
export function HomeComposer({
  value,
  onChangeText,
  onStart,
  starting,
  projectLabel,
  agent,
  onStash,
  onAttach,
  onDictate,
  bottomInset = 0,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onStart: () => void;
  starting?: boolean;
  projectLabel?: string | null;
  agent?: string | null;
  onStash?: () => void;
  onAttach?: () => void;
  onDictate?: () => void;
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
        backgroundColor: colors.bg,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          backgroundColor: colors.card,
          borderRadius: radius.pill,
          minHeight: 52,
          paddingLeft: space.sm,
          paddingRight: space.xs,
          shadowColor: colors.text,
          shadowOpacity: isDark ? 0 : 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 4 },
          elevation: 2,
          ...hairline,
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
          style={{ flex: 1, minWidth: 0, color: colors.text, ...type.body, paddingVertical: space.sm }}
        />
        <Pressable
          onPress={onDictate}
          hitSlop={8}
          accessibilityLabel="Dictate"
          style={({ pressed }) => ({
            padding: space.sm,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Icon ios="mic.fill" android="mic" size={20} color={colors.textMuted} />
        </Pressable>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          marginTop: space.md,
        }}
      >
        <Pressable onPress={onStash} hitSlop={8} accessibilityLabel="Stash" style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <Icon ios="archivebox" android="archive" size={22} color={colors.textSecondary} />
        </Pressable>
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
        <Pressable onPress={onAttach} hitSlop={8} accessibilityLabel="Attach" style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}>
          <Icon ios="paperclip" android="attach_file" size={22} color={colors.textSecondary} />
        </Pressable>
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
