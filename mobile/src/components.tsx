/**
 * Presentational pieces shared by the list screens. No data fetching here —
 * these take what they render, so a screen stays the only place that knows
 * where state comes from.
 */

import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

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
