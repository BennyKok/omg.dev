/**
 * New/Edit Bot — the sheet that gives the roster an in-app way to populate
 * itself, per docs/design/bot-mode/spec.md §5.
 *
 * TWO DELIBERATE DEPARTURES FROM THAT SPEC, BOTH BECAUSE THE SHIPPED CODE
 * MOVED ON FROM IT:
 *
 * 1. §5.2's avatar picker is an emoji entry field. The web's shipped
 *    `BotAvatar` (web/src/components/BotAvatar.tsx) has no emoji in it at
 *    all — a bot's face is a shape x colorway pair, not a character. So this
 *    sheet's identity row is a shape picker and a colorway picker instead of
 *    an emoji button. This is also the whole reason this task exists: the
 *    matrix has to be pickable somewhere for a populated roster to prove it
 *    reads as distinct individuals.
 * 2. §5.4's "Advanced" section keeps a `Collapsible` gate hiding agent/model/
 *    repo behind a tap. Phase 1 here has only two of those controls (agent,
 *    repo — no per-agent model/thinking picker yet, that's session-options.ts
 *    scope this sheet does not need for a first cut), so gating two rows
 *    behind a disclosure control added a tap without saving meaningful space.
 *    Both rows are always visible instead.
 *
 * Everything else follows §5: header with title + Create/Save, name field,
 * persona textarea, repo + agent pickers. No delete action (§5.1's second
 * trailing button) — phase 1 scope is create + edit, per the task that added
 * this file; a bot created here can still be disabled by a later PATCH, just
 * not from this sheet yet.
 */

import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { type AndroidSymbol, type SFSymbol } from "expo-symbols";

import { BottomSheet } from "./bottom-sheet";
import { BotAvatar } from "./bot-avatar";
import { Icon, IconButton } from "../components";
import { Text, TextInput } from "./text";
import { DropdownMenu, type MenuOption } from "./menu";
import { agentIcon, agentLabel } from "./agent-icons";
import { useTheme } from "./theme";
import { useToast } from "./toast";
import { useOmg } from "./provider";
import { BOT_SHAPES, BOT_COLORWAYS, type Bot, type BotColorway, type BotShape } from "./bots";

const SHAPE_LABELS: Record<BotShape, string> = {
  circle: "Circle",
  squircle: "Squircle",
  teardrop: "Teardrop",
  pebble: "Pebble",
  hexagon: "Hexagon",
};

/** Mirrors COLORWAYS in web/src/components/BotAvatar.tsx — first stop only,
 * enough for a small solid swatch; the mark itself carries the full ramp. */
const COLORWAY_SWATCH: Record<BotColorway, string> = {
  warm: "#e8873c",
  brand: "#3d6bf5",
  violet: "#9163e8",
  forest: "#3ab08a",
  midnight: "#5c6a86",
};

export function BotEditSheet({
  visible,
  bot,
  onClose,
  onSaved,
}: {
  visible: boolean;
  /** null = creating a new bot. */
  bot: Bot | null;
  onClose: () => void;
  onSaved: (bot: Bot) => void;
}) {
  const { colors, type, space, radius } = useTheme();
  const { client, user, agents, repos } = useOmg();
  const toast = useToast();

  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [shape, setShape] = useState<BotShape>("circle");
  const [colorway, setColorway] = useState<BotColorway>("warm");
  const [agent, setAgent] = useState("aisdk");
  const [cwd, setCwd] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  // Re-seed the form every time the sheet opens, not just on mount — the same
  // instance is reused for every roster row's "Edit" tap, and stale fields
  // from the last bot edited would otherwise bleed into the next one.
  useEffect(() => {
    if (!visible) return;
    setName(bot?.name ?? "");
    setPersona(bot?.persona ?? "");
    setShape(bot?.shape ?? "circle");
    setColorway(bot?.colorway ?? "warm");
    setAgent(bot?.agent ?? "aisdk");
    setCwd(bot?.cwd);
    setSaving(false);
  }, [visible, bot]);

  const canSave = name.trim().length > 0 && persona.trim().length > 0 && !saving;

  const save = async () => {
    if (!client || !canSave) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        persona: persona.trim(),
        shape,
        colorway,
        agent,
        cwd,
        user: user?.email,
      };
      const res = bot
        ? await client.transport.request<{ bot?: Bot }>(`/api/bots/${encodeURIComponent(bot.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await client.transport.request<{ bot?: Bot }>("/api/bots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res?.bot) throw new Error("No bot came back");
      onSaved(res.bot);
      onClose();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save bot");
    } finally {
      setSaving(false);
    }
  };

  const agentOptions: MenuOption[] = agents.map((a) => ({
    label: a.label ? a.label.charAt(0).toUpperCase() + a.label.slice(1) : agentLabel(a.key),
    image: agentIcon(a.key),
    selected: a.key === agent,
    onPress: () => setAgent(a.key),
  }));

  const repoOptions: MenuOption[] = [
    { label: "Default folder", selected: cwd === undefined, onPress: () => setCwd(undefined) },
    ...repos.map((r) => ({
      label: r.name,
      selected: r.cwd === cwd,
      onPress: () => setCwd(r.cwd),
    })),
  ];

  const repoLabel = cwd ? (repos.find((r) => r.cwd === cwd)?.name ?? cwd) : "Default folder";
  const agentDisplay = agents.find((a) => a.key === agent)?.label ?? agentLabel(agent);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: space.lg }}>
        {/* 5.1 Header row */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingBottom: space.md }}>
          <Icon lucide="bot" size={18} color={colors.primary} />
          <Text style={{ ...type.callout, fontWeight: "600", color: colors.text, flex: 1, marginLeft: space.sm }}>
            {bot ? "Edit bot" : "New bot"}
          </Text>
          <PrimaryButtonCompact label={bot ? "Save" : "Create"} onPress={save} disabled={!canSave} loading={saving} />
        </View>

        {/* 5.2 Identity row */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingBottom: space.lg }}>
          <BotAvatar shape={shape} colorway={colorway} size={64} />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Bot name"
            placeholderTextColor={colors.textMuted}
            autoFocus
            style={{
              flex: 1,
              ...type.callout,
              fontWeight: "600",
              color: colors.text,
              backgroundColor: colors.secondary,
              borderRadius: radius.lg,
              paddingHorizontal: space.md,
              paddingVertical: 10,
            }}
          />
        </View>

        {/* Shape picker — see file header for why this replaces the web spec's emoji field. */}
        <FieldLabel>Shape</FieldLabel>
        <View style={{ flexDirection: "row", gap: space.sm, paddingBottom: space.md }}>
          {BOT_SHAPES.map((s) => (
            <Pressable
              key={s}
              onPress={() => setShape(s)}
              accessibilityRole="button"
              accessibilityLabel={SHAPE_LABELS[s]}
              accessibilityState={{ selected: s === shape }}
              style={{
                borderRadius: radius.lg,
                borderWidth: 2,
                borderColor: s === shape ? colors.primary : "transparent",
                padding: 3,
              }}
            >
              <BotAvatar shape={s} colorway={colorway} size={44} />
            </Pressable>
          ))}
        </View>

        {/* Colorway picker */}
        <FieldLabel>Colorway</FieldLabel>
        <View style={{ flexDirection: "row", gap: space.sm, paddingBottom: space.lg }}>
          {BOT_COLORWAYS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColorway(c)}
              accessibilityRole="button"
              accessibilityLabel={c}
              accessibilityState={{ selected: c === colorway }}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 2,
                borderColor: c === colorway ? colors.primary : "transparent",
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: COLORWAY_SWATCH[c],
                }}
              />
            </Pressable>
          ))}
        </View>

        {/* 5.3 Persona */}
        <FieldLabel>Persona</FieldLabel>
        <TextInput
          value={persona}
          onChangeText={setPersona}
          placeholder="How this bot should think and talk…"
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          style={{
            ...type.callout,
            color: colors.text,
            backgroundColor: colors.secondary,
            borderRadius: radius.lg,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            minHeight: 88,
            marginBottom: space.lg,
          }}
        />

        {/* 5.4 Advanced — always visible; see file header for why this sheet
            skips the web's collapsible gate. */}
        <FieldLabel>Agent</FieldLabel>
        <DropdownMenu options={agentOptions} style={{ marginBottom: space.md }}>
          <PickerRow ios="cpu" android="memory" label={agentDisplay} />
        </DropdownMenu>

        <FieldLabel>Folder</FieldLabel>
        <DropdownMenu options={repoOptions} style={{ marginBottom: space.lg }}>
          <PickerRow ios="folder" android="folder" label={repoLabel} />
        </DropdownMenu>
      </View>
    </BottomSheet>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  const { colors, type, space } = useTheme();
  return (
    <Text
      style={{
        ...type.caption,
        textTransform: "uppercase",
        color: colors.textMuted,
        marginBottom: space.xs,
      }}
    >
      {children}
    </Text>
  );
}

function PickerRow({
  ios,
  android,
  label,
}: {
  ios: SFSymbol;
  android: AndroidSymbol;
  label: string;
}) {
  const { colors, type, space, radius } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        paddingHorizontal: space.md,
        paddingVertical: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Icon ios={ios} android={android} size={16} color={colors.textMuted} />
        <Text style={{ ...type.callout, color: colors.text }}>{label}</Text>
      </View>
      <Icon ios="chevron.up.chevron.down" android="unfold_more" size={14} color={colors.textMuted} />
    </View>
  );
}

/** A small trailing header button — PrimaryButton is sized for a full-width
 * footer, too tall for a header row. */
function PrimaryButtonCompact({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <IconButton
      onPress={onPress}
      disabled={disabled}
      busy={loading}
      ios="checkmark"
      android="check"
      accessibilityLabel={label}
      background={disabled ? colors.secondary : colors.primary}
      color={disabled ? colors.textMuted : colors.primaryForeground}
      size={16}
    />
  );
}
