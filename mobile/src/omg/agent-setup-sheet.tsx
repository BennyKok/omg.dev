/** Compact agent controls. Selection and availability belong to useAgentPicker. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, PanResponder, Platform, Pressable, StyleSheet, View } from "react-native";
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";

import { Sheet } from "./sheet";
import { SheetScrollView as ScrollView, useSheetExpanded, useBlockSheetDrag } from "./sheet-scroll";
import type { MenuOption } from "./menu";
import { PressableScale, useReduceMotionEnabled } from "./motion";
import { Text, TextInput } from "./text";
import { useTheme } from "./theme";

export function AgentSetupSheet({
  visible, onClose, agentOptions, modelOptions = [], thinkingOptions = [],
  accountOptions = [], modelLabel, agentLabel, usageRing, usageLoading, usageDetails,
  title, action, fastMode, onToggleFast, initialPage = "root",
}: {
  visible: boolean;
  onClose: () => void;
  agentOptions: MenuOption[];
  modelOptions?: MenuOption[];
  thinkingOptions?: MenuOption[];
  accountOptions?: MenuOption[];
  accountLabel?: string | null;
  modelLabel?: string | null;
  agentLabel?: string | null;
  usageRing?: ReactNode;
  usageDetails?: ReactNode;
  usageLoading?: boolean;
  title?: string;
  action?: { label: string; onPress: () => void };
  fastMode?: boolean;
  onToggleFast?: () => void;
  initialPage?: "root" | "profiles";
}) {
  const { colors, type, isDark } = useTheme();
  const [page, setPage] = useState<"root" | "models" | "profiles" | "usage">("root");
  const [recent, setRecent] = useState<Record<string, string[]>>({});
  useEffect(() => { if (visible) setPage(initialPage); }, [visible, initialPage]);
  const currentAgent = agentOptions.find(o => o.selected) ?? agentOptions[0];
  const agentKey = currentAgent?.id ?? currentAgent?.label ?? agentLabel ?? "agent";
  const pick = (option: MenuOption) => {
    if (option.disabled) return;
    void Haptics.selectionAsync();
    option.onPress?.();
  };
  const surface = isDark ? "#303030" : colors.card;
  const goBack = () => setPage("root");
  return (
    <Sheet visible={visible} onClose={onClose} pageKey={page} pageDirection={page === "root" ? "back" : "forward"} maxWidth={414}
      surfaceStyle={{ borderRadius: 22, borderWidth: 1, borderColor: isDark ? "#454545" : colors.borderSoft, backgroundColor: isDark ? "#242424" : colors.popover }}>
      <View style={{ padding: 12, paddingTop: 0, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", minHeight: 44, gap: 8 }}>
          {page !== "root" ? <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Back to agent controls"
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <SymbolView name="chevron.left" size={16} tintColor={colors.text} />
          </Pressable> : null}
          <Text numberOfLines={1} style={{ ...type.headline, flex: 1, color: colors.text }}>
            {page === "usage" ? "Usage" : page === "models" ? "Models" : page === "profiles" ? "Claude profile" : title ?? currentAgent?.label ?? agentLabel ?? "Agent"}
          </Text>
          {page === "root" ? usageRing ? <Pressable onPress={() => setPage("usage")} accessibilityRole="button" accessibilityLabel="Usage and next resets"
            style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>{usageRing}</Pressable>
            : usageLoading ? <ActivityIndicator size="small" color={colors.textMuted} /> : null : null}
        </View>
        {page === "root" ? <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
            {agentOptions.map((option, index) => <AgentTile key={option.id ?? `${option.label}:${index}`} option={option}
              onPress={() => pick(option)} onLongPress={option.id === "aisdk" && accountOptions.length ? () => { pick(option); setPage("profiles"); } : undefined} />)}
          </ScrollView>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {(modelLabel || modelOptions.length > 0) ? <Pressable accessibilityRole="button" accessibilityLabel={`Model ${modelLabel ?? modelOptions.find(o => o.selected)?.label ?? "default"}. Change model`}
            onPress={() => setPage("models")} disabled={!modelOptions.length}
            style={{ flex: 1, minHeight: 52, paddingHorizontal: 14, borderRadius: 14, backgroundColor: surface, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text numberOfLines={1} style={{ ...type.callout, flex: 1, color: colors.text }}>{modelLabel ?? modelOptions.find(o => o.selected)?.label ?? "Choose model"}</Text>
            {modelOptions.length ? <SymbolView name="chevron.right" size={14} tintColor={colors.textMuted} /> : null}
          </Pressable> : null}
          {onToggleFast ? <Pressable onPress={onToggleFast} accessibilityRole="switch" accessibilityLabel="Fast mode"
            accessibilityState={{ checked: !!fastMode }} style={{ width: 44, height: 52, alignItems: "center", justifyContent: "center" }}>
            <SymbolView name={fastMode ? "bolt.fill" : "bolt"} size={18} tintColor={fastMode ? colors.text : colors.textMuted} />
          </Pressable> : null}
          </View>
          {thinkingOptions.length ? <Slider options={thinkingOptions} onPick={option => option.onPress?.()} /> : null}
          {action ? <PressableScale onPress={action.onPress} accessibilityRole="button" style={{ alignItems: "center", padding: 12, borderRadius: 14, backgroundColor: colors.text }}>
            <Text style={{ ...type.headline, color: colors.bg }}>{action.label}</Text>
          </PressableScale> : null}
        </> : page === "usage" ? <ScrollView style={{ maxHeight: 380 }}>{usageDetails}</ScrollView> : page === "models" ? <ModelList key={agentKey} options={modelOptions} recent={recent[agentKey] ?? []} onPick={option => {
          if (option.disabled) return;
          pick(option);
          setRecent(current => ({ ...current, [agentKey]: [option.label, ...(current[agentKey] ?? []).filter(label => label !== option.label)].slice(0, 3) }));
          goBack();
        }} /> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {accountOptions.map(option => <Pressable key={option.label} disabled={option.disabled} accessibilityRole="button"
            accessibilityLabel={`Claude ${option.label}`} accessibilityState={{ selected: !!option.selected, disabled: !!option.disabled }}
            onPress={() => { pick(option); goBack(); }} style={{ width: 76, minHeight: 76, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 8,
              backgroundColor: option.selected ? colors.text : surface, opacity: option.disabled ? 0.4 : 1 }}>
            <Mark option={agentOptions.find(o => o.id === "aisdk") ?? currentAgent ?? { label: "Claude" }} size={24} />
            <Text style={{ ...type.callout, fontWeight: "600", color: option.selected ? colors.bg : colors.text }}>{option.label}</Text>
          </Pressable>)}
        </ScrollView>}
      </View>
    </Sheet>
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

/** A swipeable row of icon-only agents. Claude holds its account choices. */
function AgentTile({ option, onPress, onLongPress }: { option: MenuOption; onPress: () => void; onLongPress?: () => void }) {
  const { colors, isDark } = useTheme();
  return <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={400} disabled={option.disabled}
    accessibilityRole="button" accessibilityLabel={`${option.label} agent`}
    accessibilityHint={onLongPress ? "Long press to choose a Claude profile" : undefined}
    accessibilityActions={onLongPress ? [{ name: "profiles", label: "Choose profile" }] : undefined}
    onAccessibilityAction={event => { if (event.nativeEvent.actionName === "profiles") onLongPress?.(); }}
    accessibilityState={{ selected: !!option.selected, disabled: !!option.disabled }}
    style={{ width: 64, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", opacity: option.disabled ? 0.4 : 1,
      backgroundColor: option.selected ? (isDark ? "#454545" : colors.borderSoft) : (isDark ? "#303030" : colors.card),
      borderWidth: 1, borderColor: option.selected ? colors.textMuted : "transparent" }}>
    <Mark option={option} size={28} />
  </Pressable>;
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


/** Search and rows keep their footprint even for short or empty catalogues. */
function ModelList({ options, recent, onPick }: { options: MenuOption[]; recent: string[]; onPick: (option: MenuOption) => void }) {
  const { colors, type, space, radius } = useTheme();
  const [query, setQuery] = useState("");
  const expanded = useSheetExpanded();
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const matched = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    const current = matched.find(o => o.selected);
    return [...(current ? [current] : []), ...matched.filter(o => o !== current)];
  }, [options, q]);

  return (
    <View style={{ gap: space.sm }}>
      <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            height: 44,
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
      {!q && recent.some(label => options.some(o => o.label === label && !o.selected)) ? <View style={{ gap: 6 }}>
        <Text style={{ ...type.caption, color: colors.textMuted }}>Recent</Text>
        <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {recent.map(label => options.find(o => o.label === label && !o.selected)).filter((o): o is MenuOption => !!o).map(option =>
            <Pressable key={option.label} onPress={() => onPick(option)} accessibilityRole="button" style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: "center", borderRadius: 12, backgroundColor: colors.card }}>
              <Text style={{ ...type.callout, color: colors.text }}>{option.label}</Text>
            </Pressable>)}
        </ScrollView>
      </View> : null}
      <View style={{ borderRadius: radius.xl, backgroundColor: colors.card, overflow: "hidden" }}>
        <ScrollView
          bounces={false}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          style={{ height: 44 * (expanded ? 10.5 : MODEL_ROWS_SHOWN) }}
        >
          {shown.map((option, index) => (
            <Row key={`${option.label}:${index}`} option={option} first={index === 0} onPress={() => onPick(option)} />
          ))}
          {!shown.length ? (
            <Text style={{ ...type.footnote, color: colors.textMuted, padding: space.md }}>{options.length ? "No model matches" : "No models available"}</Text>
          ) : null}

        </ScrollView>
      </View>
    </View>
  );
}

const TRACK = 52;

/** Full-width palette from web/src/index.css .thinking-scrubber-fill. */
const THINKING_COLORS = {
  light: ["rgba(0,122,255,0.88)", "rgba(90,110,255,0.94)", "rgba(175,82,222,0.97)", "rgba(232,121,249,1)"],
  dark: ["rgba(10,132,255,0.92)", "rgba(100,120,255,0.95)", "rgba(191,90,242,0.98)", "rgba(240,140,255,1)"],
} as const;

/** The whole bar owns the gesture. The preview rises above the finger. */
export function Slider({ options, onPick }: { options: MenuOption[]; onPick: (option: MenuOption) => void }) {
  const { colors, type, isDark } = useTheme();
  const reducedMotion = useReduceMotionEnabled();
  const blockSheetDrag = useBlockSheetDrag();
  const [width, setWidth] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const selectedIndex = Math.max(0, options.findIndex(o => o.selected));
  const active = dragIndex ?? selectedIndex;
  const progress = useSharedValue((active + 1) / options.length);
  const labelX = useSharedValue(0);
  const lift = useSharedValue(0);
  useEffect(() => {
    const duration = reducedMotion ? 0 : 120;
    progress.value = withTiming((active + 1) / options.length, { duration });
    labelX.value = withTiming(Math.max(0, Math.min(width - 88, (active + 0.5) * width / options.length - 44)), { duration });
    lift.value = withTiming(dragIndex === null ? 0 : 1, { duration });
  }, [active, width, options.length, dragIndex, reducedMotion]);
  const fillStyle = useAnimatedStyle(() => ({ width: width * progress.value }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: lift.value, transform: [{ translateX: labelX.value }, { translateY: (1 - lift.value) * 8 }] }));
  const lastStep = useRef(selectedIndex);
  const latest = useRef({ width, options, selectedIndex, onPick });
  latest.current = { width, options, selectedIndex, onPick };
  const indexAt = (px: number) => Math.max(0, Math.min(latest.current.options.length - 1, Math.floor(px / (latest.current.width || 1) * latest.current.options.length)));
  const preview = (index: number) => {
    if (latest.current.options[index]?.disabled) return;
    if (lastStep.current !== index) {
      void Haptics.selectionAsync();
      lastStep.current = index;
    }
    setDragIndex(index);
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: e => { lastStep.current = latest.current.selectedIndex; preview(indexAt(e.nativeEvent.locationX)); },
    onPanResponderMove: e => preview(indexAt(e.nativeEvent.locationX)),
    onPanResponderRelease: e => {
      const i = indexAt(e.nativeEvent.locationX);
      const option = latest.current.options[i];
      preview(i);
      if (option && !option.disabled && i !== latest.current.selectedIndex) latest.current.onPick(option);
      setDragIndex(null);
    },
    onPanResponderTerminate: () => setDragIndex(null),
  })).current;
  return <View style={{ paddingTop: 28 }}>
    <Reanimated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[{ position: "absolute", top: 0, left: 0, width: 88, alignItems: "center" }, labelStyle]}>
      {dragIndex !== null ? <Text numberOfLines={1} style={{ ...type.footnote, fontWeight: "600", color: colors.text }}>{options[active]?.label}</Text> : null}
    </Reanimated.View>
    <View {...pan.panHandlers} onTouchStart={blockSheetDrag} onLayout={e => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable" accessibilityLabel="Thinking level" accessibilityValue={{ text: options[active]?.label }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={e => {
        const step = e.nativeEvent.actionName === "increment" ? 1 : -1;
        const option = options[selectedIndex + step];
        if (option && !option.disabled) { void Haptics.selectionAsync(); onPick(option); }
      }}
      style={{ height: TRACK, flexDirection: "row", borderRadius: 14, overflow: "hidden", backgroundColor: isDark ? "#191919" : colors.card }}>
      <Reanimated.View pointerEvents="none" style={[{ position: "absolute", top: 0, bottom: 0, left: 0, overflow: "hidden", borderRadius: 14 }, fillStyle]}>
        <LinearGradient colors={THINKING_COLORS[isDark ? "dark" : "light"]} locations={[0, 0.34, 0.68, 1]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ width, height: TRACK }} />
      </Reanimated.View>
      {options.map((option, index) => <View key={option.label} pointerEvents="none" style={{ flex: 1, alignItems: "center", justifyContent: "center", opacity: option.disabled ? 0.35 : 1 }}>
        {index === active && dragIndex === null ? <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ ...type.footnote, fontWeight: "600", color: "#101010", paddingHorizontal: 4 }}>{option.label}</Text>
          : <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: index <= active ? "#fff" : colors.textMuted }} />}
      </View>)}
    </View>
  </View>;
}
