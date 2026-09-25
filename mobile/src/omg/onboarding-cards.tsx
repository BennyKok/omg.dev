/**
 * Step 02: pick the first thing the agent does, from a carousel.
 *
 * Benny, 2026-09-25: outcomes, not questions. One card per thing omg.dev can
 * do on a first run, each with an App Store illustration. The button under
 * the carousel acts on the card in view and STARTS it; there is no prompt
 * screen after this.
 *
 * ── The swipe is never the only way ──────────────────────────────────────
 *
 * The pitch panels this app once opened with taught one lesson (see
 * onboarding-welcome.tsx): nobody swipes what they were not told about. So
 * the next card's edge is always in view, the dots say how many there are,
 * a tap on a card brings it into view, and the button is always on screen.
 */
import { useRef, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as Haptics from "expo-haptics";

import { Icon } from "../components";
import { PrimaryAction, StepHeader } from "./onboarding-chrome";
import { FIRST_CARDS, type CardKey } from "./onboarding-tasks";
import { Text } from "./text";
import { useTheme } from "./theme";

/** Cut from the App Store screenshots, white background removed. */
export const PICTURES: Record<CardKey, ImageSourcePropType> = {
  app: require("../../assets/onboarding/card-app.png"),
  // No game picture of its own yet; the Welcome picture stands in.
  game: require("../../assets/onboarding/welcome-grass.png"),
  website: require("../../assets/onboarding/card-website.png"),
  slides: require("../../assets/onboarding/card-slides.png"),
  news: require("../../assets/onboarding/plan-picnic.png"),
  agents: require("../../assets/onboarding/welcome-grass.png"),
};

/** How much of the next card shows at the edge. */
const PEEK = 60;
const GAP = 32;

export function CardsScreen({
  initialKey = null,
  onPick,
  onBack,
}: {
  /** Reopen with this card in view (after "Not now" on the data notice). */
  initialKey?: CardKey | null;
  onPick: (key: CardKey) => void;
  onBack?: () => void;
}) {
  const { colors, space, type } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gutter = space.lg + 4;
  const cardWidth = width - gutter * 2 - PEEK;
  const step = cardWidth + GAP;
  const startIndex = Math.max(0, FIRST_CARDS.findIndex((card) => card.key === initialKey));
  const [index, setIndex] = useState(startIndex);
  const scroller = useRef<ScrollViewInstance>(null);

  const settle = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / step);
    setIndex(Math.max(0, Math.min(FIRST_CARDS.length - 1, next)));
  };
  const card = FIRST_CARDS[index]!;
  const go = (next: number) => {
    const target = Math.max(0, Math.min(FIRST_CARDS.length - 1, next));
    void Haptics.selectionAsync();
    setIndex(target);
    scroller.current?.scrollTo({ x: target * step, animated: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <StepHeader onBack={onBack} />
      {/* The page's name, as a question (Benny, 2026-09-25). */}
      <View style={{ paddingHorizontal: gutter }}>
        <Text style={{ ...type.largeTitle, color: colors.text }}>What to build?</Text>
      </View>

      <View style={{ flex: 1, justifyContent: "center", paddingVertical: space.lg }}>
        <ScrollView
          ref={scroller}
          horizontal
          // Cards are as tall as their content, not the screen: a horizontal
          // ScrollView stretches its children unless told otherwise.
          style={{ flexGrow: 0 }}
          showsHorizontalScrollIndicator={false}
          snapToInterval={step}
          decelerationRate="fast"
          contentOffset={{ x: startIndex * step, y: 0 }}
          contentContainerStyle={{ paddingHorizontal: gutter, gap: GAP, alignItems: "flex-start" }}
          onMomentumScrollEnd={settle}
          onScrollEndDrag={settle}
        >
          {FIRST_CARDS.map((item, i) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.body}`}
              accessibilityState={{ selected: i === index }}
              // A tap on a card brings it into view, so the swipe is never
              // the only way to reach one.
              onPress={() => go(i)}
              // No card surface (Benny, 2026-09-25): the picture and the words
              // sit on the page, the same way the Welcome screen draws them.
              style={{ width: cardWidth, gap: space.md }}
            >
              <Image source={PICTURES[item.key]} style={{ width: "100%", height: 240 }} resizeMode="contain" />
              {/* Every card shows its words all the time: hiding the ones out
                  of view made the text arrive late on every swipe. */}
              <View style={{ gap: space.xs }}>
                <Text style={{ ...type.largeTitle, fontSize: 40, lineHeight: 44, color: colors.text }}>{item.title}</Text>
                <Text style={{ ...type.title, fontWeight: "400", color: colors.textMuted }}>{item.body}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, marginTop: space.lg }}>
          {FIRST_CARDS.map((item, i) => (
            <View
              key={item.key}
              style={{
                width: i === index ? 18 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: i === index ? colors.text : colors.border,
              }}
            />
          ))}
        </View>
      </View>

      {/* Arrows either side of the button (Benny, 2026-09-25), so moving
          between cards is a tap as well as a swipe. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          paddingHorizontal: gutter,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.lg,
        }}
      >
        <Arrow direction="left" disabled={index === 0} onPress={() => go(index - 1)} />
        <View style={{ flex: 1 }}>
          <PrimaryAction label={card.action} onPress={() => onPick(card.key)} />
        </View>
        <Arrow direction="right" disabled={index === FIRST_CARDS.length - 1} onPress={() => go(index + 1)} />
      </View>
    </View>
  );
}

/** A round arrow button beside the main one. Dimmed at either end. */
function Arrow({
  direction,
  disabled,
  onPress,
}: {
  direction: "left" | "right";
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={direction === "left" ? "Previous" : "Next"}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.card,
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
      })}
    >
      <Icon
        ios={direction === "left" ? "chevron.left" : "chevron.right"}
        android={direction === "left" ? "chevron_left" : "chevron_right"}
        size={18}
        color={colors.text}
      />
    </Pressable>
  );
}
