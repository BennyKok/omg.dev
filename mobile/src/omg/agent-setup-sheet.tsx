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
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Reanimated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";

import { GlassSurface } from "./glass";
import type { MenuOption } from "./menu";
import { PressableScale } from "./motion";
import { Text } from "./text";
import { useTheme } from "./theme";
import type { UsageWindow } from "./usage";

const LAYOUT = LinearTransition.duration(160).easing(Easing.out(Easing.quad));

export function AgentSetupSheet({
  visible,
  onClose,
  agentOptions,
  modelOptions,
  thinkingOptions,
  usageRing,
  usageWindows,
  usageLoading,
}: {
  visible: boolean;
  onClose: () => void;
  agentOptions: MenuOption[];
  modelOptions?: MenuOption[];
  thinkingOptions?: MenuOption[];
  /** The current agent's usage ring, drawn by the composer so this file does not import it. */
  usageRing?: ReactNode;
  usageWindows?: UsageWindow[];
  usageLoading?: boolean;
}) {
  const { colors, type, space, radius, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  /**
   * The Modal unmounts on the same frame `visible` drops, which would cut the
   * exit animation. Keep it mounted one beat longer so the card can slide
   * away, then let the Modal go.
   */
  const [mounted, setMounted] = useState(visible);
  useEffect(() => {
    if (visible) setMounted(true);
    else {
      const t = setTimeout(() => setMounted(false), 150);
      return () => clearTimeout(t);
    }
  }, [visible]);
  /**
   * The agent row starts folded to the current agent. Opening the sheet is
   * usually about the model or the level, and five marks in a row would
   * shout over both. Tap the agent to see the others; tap one to choose it,
   * and the row folds again.
   */
  const [agentsOpen, setAgentsOpen] = useState(false);
  useEffect(() => {
    if (!visible) setAgentsOpen(false);
  }, [visible]);
  if (!mounted) return null;

  const pick = (option: MenuOption) => {
    if (option.disabled) return;
    void Haptics.selectionAsync();
    option.onPress?.();
  };
  const currentAgent = agentOptions.find((o) => o.selected) ?? agentOptions[0];

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        {visible ? (
          <Reanimated.View
            entering={FadeIn.duration(120)}
            exiting={FadeOut.duration(120)}
            style={StyleSheet.absoluteFill}
          >
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={{ flex: 1, backgroundColor: isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.25)" }}
            />
          </Reanimated.View>
        ) : null}
        {visible ? (
          <Reanimated.View
            entering={FadeInDown.duration(170).easing(Easing.out(Easing.cubic))}
            exiting={FadeOutDown.duration(130)}
            layout={LAYOUT}
            style={{ marginHorizontal: 10, marginBottom: Math.max(insets.bottom, 10) }}
          >
            <GlassSurface
              variant="regular"
              fallbackColor={colors.popover}
              style={{ borderRadius: 30, overflow: "hidden" }}
            >
              <View style={{ paddingTop: 8, paddingBottom: space.lg, gap: space.lg }}>
                {/* Grabber: the card reads as a sheet, and a sheet reads as dismissable. */}
                <View
                  style={{
                    alignSelf: "center",
                    width: 36,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: colors.borderStrong,
                  }}
                />

                {agentOptions.length && currentAgent ? (
                  <Reanimated.View layout={LAYOUT} style={{ gap: space.sm }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: space.lg + 4,
                        gap: space.sm,
                      }}
                    >
                      <Text style={{ ...type.caption, color: colors.textMuted, flex: 1 }}>Agent</Text>
                      {usageWindows?.length ? (
                        <Text style={{ ...type.caption, color: colors.textMuted }}>
                          {usageWindows
                            .filter((w) => w.pct !== null)
                            .map((w) => `${w.label} ${Math.round(w.pct ?? 0)}%`)
                            .join("  ")}
                        </Text>
                      ) : null}
                      {usageRing ??
                        (usageLoading ? <ActivityIndicator size="small" color={colors.textMuted} /> : null)}
                    </View>
                    {agentsOpen ? (
                      <Reanimated.View entering={FadeIn.duration(120)} layout={LAYOUT}>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          keyboardShouldPersistTaps="handled"
                          contentContainerStyle={{ paddingHorizontal: space.lg, gap: 14 }}
                        >
                          {agentOptions.map((option, index) => (
                            <AgentTile
                              key={`${option.label}:${index}`}
                              option={option}
                              onPress={() => {
                                pick(option);
                                setAgentsOpen(false);
                              }}
                            />
                          ))}
                        </ScrollView>
                      </Reanimated.View>
                    ) : (
                      <Reanimated.View
                        entering={FadeIn.duration(120)}
                        layout={LAYOUT}
                        style={{ paddingHorizontal: space.lg }}
                      >
                        <PressableScale
                          onPress={() => setAgentsOpen(true)}
                          scale={0.97}
                          accessibilityRole="button"
                          accessibilityLabel={`${currentAgent.label} agent. Change`}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: space.md,
                            alignSelf: "flex-start",
                            paddingRight: space.lg,
                            paddingLeft: 4,
                            paddingVertical: 4,
                            borderRadius: radius.pill,
                            backgroundColor: colors.card,
                          }}
                        >
                          <View
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 18,
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: colors.bg,
                            }}
                          >
                            <Mark option={currentAgent} size={20} />
                          </View>
                          <Text style={{ ...type.subhead, fontWeight: "600", color: colors.text }}>
                            {currentAgent.label}
                          </Text>
                          <SymbolIf name="chevron.down" color={colors.textMuted} />
                        </PressableScale>
                      </Reanimated.View>
                    )}
                  </Reanimated.View>
                ) : null}

                {modelOptions?.length ? (
                  <Reanimated.View layout={LAYOUT} style={{ gap: space.sm }}>
                    <Heading>Model</Heading>
                    <View
                      style={{
                        marginHorizontal: space.lg,
                        borderRadius: radius.xl,
                        backgroundColor: colors.card,
                        overflow: "hidden",
                      }}
                    >
                      {modelOptions.map((option, index) => (
                        <Row
                          key={`${option.label}:${index}`}
                          option={option}
                          first={index === 0}
                          onPress={() => pick(option)}
                        />
                      ))}
                    </View>
                  </Reanimated.View>
                ) : null}

                {thinkingOptions?.length ? (
                  <Reanimated.View layout={LAYOUT} style={{ gap: space.sm }}>
                    <Heading>Thinking</Heading>
                    <View style={{ marginHorizontal: space.lg }}>
                      <Slider options={thinkingOptions} onPick={pick} />
                    </View>
                  </Reanimated.View>
                ) : null}
              </View>
            </GlassSurface>
          </Reanimated.View>
        ) : null}
      </View>
    </Modal>
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

function SymbolIf({ name, color }: { name: "chevron.down" | "checkmark"; color: string }) {
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
        <View
          key={`${option.label}:${index}`}
          pointerEvents="none"
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Text
            numberOfLines={1}
            style={{
              ...type.footnote,
              fontWeight: "600",
              color: index === active ? colors.bg : colors.textSecondary,
            }}
          >
            {option.label}
          </Text>
        </View>
      ))}
    </View>
  );
}
