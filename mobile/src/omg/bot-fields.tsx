/**
 * Shared building blocks for the two full-page bot screens: the stepped
 * create flow (bot-create-flow.tsx) and the all-at-once edit screen
 * (bot-edit-screen.tsx).
 *
 * WHY TWO SCREENS SHARING PIECES INSTEAD OF ONE SCREEN WITH A MODE FLAG.
 * A stepped wizard and an all-fields-visible editor are different shapes of
 * screen, not two skins on the same one: the wizard owns a step index, a
 * progress bar, per-step validation, and a Continue/Back rhythm; the editor
 * owns none of that — everything is reachable at once and the one gate is
 * "did something change." Forcing both into one component means every
 * layout decision (does this render behind a step gate? does the footer
 * button say "Continue" or "Save"? is Back "previous step" or "leave"?)
 * grows an `if (stepped)` branch, and the result reads like two screens
 * fighting inside one file. Splitting the SCREENS and sharing the FIELDS —
 * the avatar hero, the pickers, the text inputs, the chrome — gets the
 * identical visual language (which is the actual design requirement) without
 * that contortion.
 *
 * Matches sign-in.tsx's visual language (the app's own full-page,
 * onboarding-flavored screen) rather than importing anything from web: plain
 * rounded fields on `fieldFill`, a title + muted footnote subtitle pair, one
 * pinned primary action at the foot of the screen.
 */

import { Pressable, StyleSheet, View } from "react-native";
import { type AndroidSymbol, type SFSymbol } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, IconButton } from "../components";
import { BotAvatar } from "./bot-avatar";
import { GlassSurface } from "./glass";
import { Text, TextInput } from "./text";
import { type MenuOption } from "./menu";
import { agentIcon, agentLabel } from "./agent-icons";
import { useTheme } from "./theme";
import type { CodingAgent, Repo } from "./provider";
import { BOT_SHAPES, BOT_COLORWAYS, type BotColorway, type BotShape } from "./bots";

export const SHAPE_LABELS: Record<BotShape, string> = {
  circle: "Circle",
  squircle: "Squircle",
  teardrop: "Teardrop",
  pebble: "Pebble",
  hexagon: "Hexagon",
};

export const COLORWAY_LABELS: Record<BotColorway, string> = {
  warm: "Warm",
  brand: "Brand",
  violet: "Violet",
  forest: "Forest",
  midnight: "Midnight",
};

/** Mirrors COLORWAYS in web/src/components/BotAvatar.tsx — first stop only,
 * enough for a solid swatch; the mark itself carries the full ramp. */
export const COLORWAY_SWATCH: Record<BotColorway, string> = {
  warm: "#e8873c",
  brand: "#3d6bf5",
  violet: "#9163e8",
  forest: "#3ab08a",
  midnight: "#5c6a86",
};

/**
 * The top bar every full-page bot screen shares: a back control, and
 * optionally a step progress bar in the space next to it. No title here —
 * each screen's own heading lives in the scroll content, same as sign-in.tsx,
 * so it scrolls with the rest of the page instead of being nailed to a bar.
 */
export function FlowHeader({
  onBack,
  progress,
}: {
  onBack: () => void;
  /** Present only on the stepped create flow. */
  progress?: { total: number; current: number };
}) {
  const insets = useSafeAreaInsets();
  const { colors, space } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingTop: insets.top + space.sm,
        paddingHorizontal: space.lg,
        paddingBottom: space.sm,
      }}
    >
      <IconButton ios="chevron.backward" android="arrow_back" accessibilityLabel="Back" onPress={onBack} />
      {progress ? (
        <View style={{ flex: 1, flexDirection: "row", gap: space.xs }}>
          {Array.from({ length: progress.total }).map((_, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                backgroundColor: i <= progress.current ? colors.primary : colors.border,
              }}
            />
          ))}
        </View>
      ) : (
        <View style={{ flex: 1 }} />
      )}
    </View>
  );
}

/** The single pinned action at the foot of the screen — the one place the
 * primary "what happens if I tap this" lives, so it never competes with
 * anything else on screen for that role. */
export function FlowFooter({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { colors, space } = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: space.xl,
        paddingTop: space.md,
        paddingBottom: Math.max(insets.bottom, space.lg),
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
        backgroundColor: colors.bg,
      }}
    >
      {children}
    </View>
  );
}

export function StepHeading({ title, subtitle }: { title: string; subtitle: string }) {
  const { colors, type, space } = useTheme();
  return (
    <View style={{ marginBottom: space.xl }}>
      <Text style={{ ...type.title, color: colors.text }}>{title}</Text>
      <Text style={{ ...type.footnote, color: colors.textMuted, marginTop: space.xs, lineHeight: 19 }}>
        {subtitle}
      </Text>
    </View>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  const { colors, type, space } = useTheme();
  return (
    <Text
      style={{
        ...type.caption,
        textTransform: "uppercase",
        color: colors.textMuted,
        marginBottom: space.sm,
      }}
    >
      {children}
    </Text>
  );
}

/**
 * The hero moment: a bot's face, large and alone on a glass panel. Everybody
 * lands here first in the create flow, and it stays the anchor of the
 * identity section in the edit screen too — see the file header on why
 * choosing shape/colorway earns the space a cramped strip never had.
 */
export function AvatarHero({ shape, colorway }: { shape: BotShape; colorway: BotColorway }) {
  const { colors, radius, space } = useTheme();
  return (
    <GlassSurface
      variant="regular"
      fallbackColor={colors.card}
      style={{
        borderRadius: radius.xl,
        paddingVertical: space.xxl,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <BotAvatar shape={shape} colorway={colorway} size={112} />
    </GlassSurface>
  );
}

export function ShapePicker({
  shape,
  colorway,
  onChange,
}: {
  shape: BotShape;
  colorway: BotColorway;
  onChange: (shape: BotShape) => void;
}) {
  const { colors, radius, space } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      {BOT_SHAPES.map((s) => (
        <Pressable
          key={s}
          onPress={() => onChange(s)}
          accessibilityRole="button"
          accessibilityLabel={SHAPE_LABELS[s]}
          accessibilityState={{ selected: s === shape }}
          style={{
            borderRadius: radius.lg,
            borderWidth: 2,
            borderColor: s === shape ? colors.primary : "transparent",
            padding: space.xs,
          }}
        >
          <BotAvatar shape={s} colorway={colorway} size={52} />
        </Pressable>
      ))}
    </View>
  );
}

export function ColorwayPicker({
  colorway,
  onChange,
}: {
  colorway: BotColorway;
  onChange: (colorway: BotColorway) => void;
}) {
  const { colors, space } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      {BOT_COLORWAYS.map((c) => (
        <Pressable
          key={c}
          onPress={() => onChange(c)}
          accessibilityRole="button"
          accessibilityLabel={COLORWAY_LABELS[c]}
          accessibilityState={{ selected: c === colorway }}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 2,
            borderColor: c === colorway ? colors.primary : "transparent",
          }}
        >
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              backgroundColor: COLORWAY_SWATCH[c],
            }}
          />
        </Pressable>
      ))}
      {/* Reserves the row's own gap math against space-between without a
          sixth swatch — same trick a trailing spacer plays elsewhere in the
          app; five items under space-between already sit evenly, this is
          just future-proofing if a colorway is ever added. */}
    </View>
  );
}

export function NameField({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const { colors, type, space, radius } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="Bot name"
      placeholderTextColor={colors.textMuted}
      autoFocus={autoFocus}
      style={{
        ...type.title,
        color: colors.text,
        backgroundColor: colors.fieldFill,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderStrong,
        borderRadius: radius.xl,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
      }}
    />
  );
}

export function PersonaField({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const { colors, type, space, radius } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder="How this bot should think and talk…"
      placeholderTextColor={colors.textMuted}
      autoFocus={autoFocus}
      multiline
      numberOfLines={8}
      textAlignVertical="top"
      style={{
        ...type.body,
        color: colors.text,
        backgroundColor: colors.fieldFill,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.borderStrong,
        borderRadius: radius.xl,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        minHeight: 168,
      }}
    />
  );
}

/** The trigger row a DropdownMenu hangs off — plain View, never itself a
 * Pressable. See menu.tsx: the whole child tree is the menu's own trigger,
 * so a nested pressable here would be two touch handlers on one tap. */
export function PickerField({
  label,
  value,
  ios,
  android,
}: {
  label: string;
  value: string;
  ios: SFSymbol;
  android: AndroidSymbol;
}) {
  const { colors, type, space, radius } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: colors.card,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        borderRadius: radius.lg,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, flex: 1, minWidth: 0 }}>
        <Icon ios={ios} android={android} size={18} color={colors.textMuted} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ ...type.caption, color: colors.textMuted, textTransform: "uppercase" }}>{label}</Text>
          <Text style={{ ...type.body, color: colors.text, marginTop: 2 }} numberOfLines={1}>
            {value}
          </Text>
        </View>
      </View>
      <Icon ios="chevron.up.chevron.down" android="unfold_more" size={14} color={colors.textMuted} />
    </View>
  );
}

export function buildAgentOptions(
  agents: CodingAgent[],
  agent: string,
  setAgent: (agent: string) => void,
): MenuOption[] {
  return agents.map((a) => ({
    label: a.label ? a.label.charAt(0).toUpperCase() + a.label.slice(1) : agentLabel(a.key),
    image: agentIcon(a.key),
    selected: a.key === agent,
    onPress: () => setAgent(a.key),
  }));
}

export function buildRepoOptions(
  repos: Repo[],
  cwd: string | undefined,
  setCwd: (cwd: string | undefined) => void,
): MenuOption[] {
  return [
    { label: "Default folder", selected: cwd === undefined, onPress: () => setCwd(undefined) },
    ...repos.map((r) => ({
      label: r.name,
      selected: r.cwd === cwd,
      onPress: () => setCwd(r.cwd),
    })),
  ];
}

export function agentDisplayLabel(agents: CodingAgent[], agent: string): string {
  return agents.find((a) => a.key === agent)?.label ?? agentLabel(agent);
}

export function repoDisplayLabel(repos: Repo[], cwd: string | undefined): string {
  return cwd ? (repos.find((r) => r.cwd === cwd)?.name ?? cwd) : "Default folder";
}
