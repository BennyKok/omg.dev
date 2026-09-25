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

import { PrimaryAction, StepHeader } from "./onboarding-chrome";
import { FIRST_CARDS, type CardKey } from "./onboarding-tasks";
import { Text } from "./text";
import { useTheme } from "./theme";

/** Cut from the App Store screenshots, white background removed. */
const PICTURES: Record<CardKey, ImageSourcePropType> = {
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {/* No heading (Benny, 2026-09-25): the cards say it themselves. */}
      <StepHeader onBack={onBack} />

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
              onPress={() => {
                // A tap on a card brings it into view, so the swipe is never
                // the only way to reach one.
                setIndex(i);
                scroller.current?.scrollTo({ x: i * step, animated: true });
              }}
              // No card surface (Benny, 2026-09-25): the picture and the words
              // sit on the page, the same way the Welcome screen draws them.
              style={{ width: cardWidth, gap: space.md }}
            >
              <Image source={PICTURES[item.key]} style={{ width: "100%", height: 240 }} resizeMode="contain" />
              {/* Only the card in view shows its words. With no card surface,
                  a neighbour's title cut at the screen edge read as broken
                  text; its picture's edge is enough to say there is more. */}
              <View style={{ gap: space.xs, opacity: i === index ? 1 : 0 }}>
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

      <View style={{ paddingHorizontal: gutter, paddingTop: space.md, paddingBottom: insets.bottom + space.lg }}>
        <PrimaryAction label={card.action} onPress={() => onPick(card.key)} />
      </View>
    </View>
  );
}
