/**
 * The composer's agent / model / thinking picker, as ONE CARD.
 *
 * This replaced a native menu whose three rows ("Claude", "opus", "Medium")
 * each opened a submenu. Three questions behind three chevrons meant three
 * round trips to change a setup, and a submenu trigger cannot carry the
 * agent's own mark, so the rows read as bare words. Here every choice is on
 * one surface. The backdrop puts it away; there is no Done, because every
 * tap already took effect.
 *
 * Fed by the same `MenuOption` lists the menu used, so the option owners in
 * session-options.ts are unchanged and nothing here decides what is selected.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, PanResponder, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";

import { Sheet } from "./sheet";
import type { MenuOption } from "./menu";
import { PressableScale } from "./motion";
import { Text, TextInput } from "./text";
import { useTheme } from "./theme";

export function AgentSetupSheet({
  visible,
  onClose,
  agentOptions,
  modelOptions,
  thinkingOptions,
  usageRing,
  usageLoading,
  title,
  action,
}: {
  visible: boolean;
  onClose: () => void;
  agentOptions: MenuOption[];
  modelOptions?: MenuOption[];
  thinkingOptions?: MenuOption[];
  /** The current agent's usage ring, drawn by the composer so this file does not import it. */
  usageRing?: ReactNode;
  usageLoading?: boolean;
  /** A heading above the sections, for a sheet that is asking a question ("Continue with"). */
  title?: string;
  /**
   * A confirm button at the bottom. The composer's picker has none, because
   * every tap there already took effect; a sheet that ends in an ACT (start
   * a new session) needs the act to be one deliberate press.
   */
  action?: { label: string; onPress: () => void };
}) {
  const { colors, type, space, radius } = useTheme();
  const pick = (option: MenuOption) => {
    if (option.disabled) return;
    void Haptics.selectionAsync();
    option.onPress?.();
  };
  const currentAgent = agentOptions.find((o) => o.selected) ?? agentOptions[0];

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingBottom: space.lg, gap: space.lg }}>
        {title ? <Text style={{ ...type.headline, color: colors.text, paddingHorizontal: space.lg + 4 }}>{title}</Text> : null}
        {agentOptions.length ? (
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg + 4, gap: space.sm }}>
              <Text style={{ ...type.caption, color: colors.textMuted, flex: 1 }}>Agent</Text>
              {usageRing ?? (usageLoading ? <ActivityIndicator size="small" color={colors.textMuted} /> : null)}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: space.lg, gap: 14 }}>
              {agentOptions.map((option, index) => (
                <AgentTile key={`${option.label}:${index}`} option={option} onPress={() => pick(option)} />
              ))}
            </ScrollView>
          </View>
        ) : null}
        <View style={{ gap: space.sm }}>
          <Heading>Model</Heading>
          <ModelList key={`${visible}:${currentAgent?.label}`} options={modelOptions ?? []} onPick={pick} />
        </View>
        <View style={{ gap: space.sm }}>
          <Heading>Thinking</Heading>
          <View style={{ marginHorizontal: space.lg }}>
            {thinkingOptions?.length ? <Slider options={thinkingOptions} onPick={pick} /> : (
              <View style={{ height: TRACK, justifyContent: "center" }}>
                <Text style={{ ...type.footnote, color: colors.textMuted }}>No thinking level for this model</Text>
              </View>
            )}
          </View>
        </View>
        {action ? (
          <View style={{ marginHorizontal: space.lg }}>
            <PressableScale onPress={action.onPress} scale={0.98} accessibilityRole="button"
              style={{ alignItems: "center", paddingVertical: 12, borderRadius: radius.lg, backgroundColor: colors.text }}>
              <Text style={{ ...type.headline, color: colors.bg }}>{action.label}</Text>
            </PressableScale>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}

function Heading({ children }: { children: string }) {
  const { colors, type, space } = useTheme();
  return (
    <Text style={{ ...type.caption, color: colors.textMuted, paddingHorizontal: space.lg + 4 }}>
      {children}
    </Text>
  );
}

function SymbolIf({
  name,
  color,
}: {
  name: "chevron.down" | "checkmark" | "magnifyingglass";
  color: string;
}) {
  if (Platform.OS !== "ios") {
    return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />;
  }
  return <SymbolView name={name} size={12} weight="semibold" tintColor={color} />;
}

/** The agent's mark, or its initial when the box reports one without artwork. */
function Mark({ option, size }: { option: MenuOption; size: number }) {
  const { colors, type } = useTheme();
  return option.image ? (
    <Image
      source={option.image}
      style={{ width: size, height: size, borderRadius: option.round ? size / 2 : 0 }}
    />
  ) : (
    <Text style={{ ...type.headline, color: colors.text }}>{option.label.slice(0, 1)}</Text>
  );
}

/** One agent: its mark in a disc, its name beneath. The current one wears a ring. */
function AgentTile({ option, onPress }: { option: MenuOption; onPress: () => void }) {
  const { colors, type } = useTheme();
  const selected = !!option.selected;
  return (
    <PressableScale
      onPress={onPress}
      scale={0.94}
      disabled={option.disabled}
      accessibilityRole="button"
      accessibilityLabel={`${option.label} agent`}
      accessibilityState={{ selected, disabled: !!option.disabled }}
      style={{ alignItems: "center", gap: 6, width: 64, opacity: option.disabled ? 0.4 : 1 }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.card,
          borderWidth: 2,
          borderColor: selected ? colors.text : "transparent",
        }}
      >
        <Mark option={option} size={28} />
      </View>
      <Text
        numberOfLines={1}
        style={{
          ...type.caption,
          fontWeight: selected ? "600" : "500",
          color: selected ? colors.text : colors.textSecondary,
        }}
      >
        {option.label}
      </Text>
    </PressableScale>
  );
}

/** One choice in an inset list, iOS style: label, hairline above, check at the end. */
function Row({ option, first, onPress }: { option: MenuOption; first: boolean; onPress: () => void }) {
  const { colors, type, space } = useTheme();
  const selected = !!option.selected;
  return (
    <PressableScale
      onPress={onPress}
      dim={0.6}
      disabled={option.disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!option.disabled }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 44,
        paddingHorizontal: space.lg,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: colors.borderSoft,
        opacity: option.disabled ? 0.4 : 1,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          ...type.body,
          flex: 1,
          fontWeight: selected ? "600" : "400",
          color: selected ? colors.text : colors.textSecondary,
        }}
      >
        {option.label}
      </Text>
      {selected ? <SymbolIf name="checkmark" color={colors.text} /> : null}
    </PressableScale>
  );
}

/** Stable space keeps controls in place across agents and search results. */
const MODEL_ROWS_SHOWN = 5.5;
const MODEL_MAX_RESULTS = 40;

/** Search and rows keep their footprint even for short or empty catalogues. */
function ModelList({ options, onPick }: { options: MenuOption[]; onPick: (option: MenuOption) => void }) {
  const { colors, type, space, radius } = useTheme();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const matched = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    if (q || options.length < 8) return matched.slice(0, MODEL_MAX_RESULTS);
    const current = matched.find((o) => o.selected);
    return [...(current ? [current] : []), ...matched.filter((o) => o !== current)].slice(
      0,
      MODEL_MAX_RESULTS,
    );
  }, [options, q]);
  const hidden = (q ? options.filter((o) => o.label.toLowerCase().includes(q)).length : options.length) - shown.length;

  return (
    <View style={{ marginHorizontal: space.lg, gap: space.sm }}>
      <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height: 36,
            paddingHorizontal: space.md,
            borderRadius: radius.lg,
            backgroundColor: colors.card,
          }}
        >
          <SymbolIf name="magnifyingglass" color={colors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${options.length} models`}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={{ flex: 1, ...type.callout, color: colors.text, paddingVertical: 0 }}
          />
      </View>
      <View style={{ borderRadius: radius.xl, backgroundColor: colors.card, overflow: "hidden" }}>
        <ScrollView
          bounces={false}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          style={{ height: 44 * MODEL_ROWS_SHOWN }}
        >
          {shown.map((option, index) => (
            <Row key={`${option.label}:${index}`} option={option} first={index === 0} onPress={() => onPick(option)} />
          ))}
          {!shown.length ? (
            <Text style={{ ...type.footnote, color: colors.textMuted, padding: space.md }}>{options.length ? "No model matches" : "No models available"}</Text>
          ) : null}
          {hidden > 0 ? (
            <Text style={{ ...type.footnote, color: colors.textMuted, padding: space.md }}>
              {hidden} more. Keep typing.
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

const PAD = 3;
const TRACK = 36;

/**
 * A segmented control whose thumb can be DRAGGED, not only tapped. The thumb
 * follows the finger across the track and snaps to the nearest segment on
 * release; a tap is the degenerate drag. Levels are ordered, so sliding
 * through them is the gesture that matches the thing.
 */
function Slider({ options, onPick }: { options: MenuOption[]; onPick: (option: MenuOption) => void }) {
  const { colors, type, radius } = useTheme();
  const [width, setWidth] = useState(0);
  const count = options.length;
  const segment = width > 0 ? (width - PAD * 2) / count : 0;
  const selectedIndex = Math.max(0, options.findIndex((o) => o.selected));
  /** The segment under the finger while dragging; null when at rest. */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const x = useSharedValue(0);
  const dragging = useSharedValue(false);

  useEffect(() => {
    if (!segment) return;
    if (dragIndex === null) x.value = withTiming(selectedIndex * segment, { duration: 140 });
  }, [selectedIndex, segment, dragIndex, x]);

  // The responder is created once; it reads the latest geometry through this ref.
  const latest = useRef({ segment, count, options, selectedIndex });
  latest.current = { segment, count, options, selectedIndex };

  const indexAt = (px: number) => {
    const { segment: s, count: n } = latest.current;
    if (!s) return 0;
    return Math.min(n - 1, Math.max(0, Math.floor((px - PAD) / s)));
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { segment: s } = latest.current;
        dragging.value = true;
        const i = indexAt(e.nativeEvent.locationX);
        setDragIndex(i);
        x.value = withTiming(i * s, { duration: 100 });
      },
      onPanResponderMove: (e) => {
        const { segment: s, count: n } = latest.current;
        const px = e.nativeEvent.locationX;
        const max = (n - 1) * s;
        x.value = Math.min(max, Math.max(0, px - PAD - s / 2));
        setDragIndex(indexAt(px));
      },
      onPanResponderRelease: (e) => {
        const { segment: s, options: opts, selectedIndex: current } = latest.current;
        const i = indexAt(e.nativeEvent.locationX);
        dragging.value = false;
        x.value = withTiming(i * s, { duration: 120 });
        setDragIndex(null);
        const option = opts[i];
        if (option && i !== current) onPick(option);
      },
      onPanResponderTerminate: () => {
        const { segment: s, selectedIndex: current } = latest.current;
        dragging.value = false;
        x.value = withTiming(current * s, { duration: 120 });
        setDragIndex(null);
      },
    }),
  ).current;

  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { scale: dragging.value ? 1.04 : 1 }],
  }));
  const active = dragIndex ?? selectedIndex;

  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel="Thinking level"
      accessibilityValue={{ text: options[selectedIndex]?.label }}
      style={{
        flexDirection: "row",
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        padding: PAD,
        height: TRACK,
      }}
    >
      {segment ? (
        <Reanimated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: PAD,
              left: PAD,
              width: segment,
              height: TRACK - PAD * 2,
              borderRadius: radius.md,
              backgroundColor: colors.text,
            },
            thumb,
          ]}
        />
      ) : null}
      {options.map((option, index) => (
        // Labels take no touches, so every event reports `locationX` against
        // the track itself rather than against whichever label was under the
        // finger. Without this a release over "High" measured inside "High"
        // and snapped back to the old segment.
        //
        // ONLY THE ACTIVE SEGMENT SAYS ITS NAME. Seven levels in 350pt
        // truncated to "Medi..." and "Think...", which named nothing. The
        // rest are dots: the track reads as a scale, and the name you are
        // on is the one you need.
        <View
          key={`${option.label}:${index}`}
          pointerEvents="none"
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          {index === active ? (
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
              style={{ ...type.footnote, fontWeight: "600", color: colors.bg, paddingHorizontal: 4 }}
            >
              {option.label}
            </Text>
          ) : (
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.textMuted }} />
          )}
        </View>
      ))}
    </View>
  );
}
