/**
 * Step 04: your agents are on it, and the ask for notifications.
 *
 * ── Why the ask lands here and not earlier ────────────────────────────────
 *
 * push.ts is emphatic about this and it is the reason this screen exists at
 * all: never prompt at first launch. iOS does not let you ask twice, so a
 * prompt shown before there is any context trades one possible yes for a
 * permanent, unrecoverable no. By this point the person has written a task and
 * watched it start -- "tell me when this is done" is now a request they
 * actually have.
 *
 * "Not now" is a real answer with a real path back, in Settings, which is
 * where the equivalent toggle already lives.
 *
 * ── The village is a preview, drawn from their own answer ─────────────────
 *
 * Not a screenshot. The scene, the count and the bubble come from the session
 * that just started, so what it shows is true. It is the blossom orchard here
 * because onboarding is its own moment; the widget itself stays on the
 * everyday garden.
 *
 * Design: artboard "04 · Working + village [07 + 08]".
 */
import { Image, ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { agentIcon } from "./agent-icons";
import { PrimaryAction, SecondaryAction, StepHeader, StepHeading } from "./onboarding-chrome";
import { Text } from "./text";
import { useTheme } from "./theme";
import { backgroundsFor } from "./village-scene";

export function WorkingScreen({
  title,
  agent,
  runningCount,
  onNotify,
  onSkip,
  onBack,
}: {
  title: string;
  agent: string;
  runningCount: number;
  onNotify: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const { colors, isDark, radius, space, type } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const plates = backgroundsFor("blossom");

  /*
   * The scene is a fixed square, 302pt on the 390pt design and never wider
   * than the content column on a narrower phone. A square that took the
   * artwork's own pixel size ran off the bottom of a 6.3" screen and put the
   * buttons over the picture; a fixed side and `cover` cropping keep the art a
   * backdrop, which is what it is.
   */
  const scene = Math.min(302, width - (space.lg + 4) * 2);
  const bubbleLeft = Math.round(scene * 0.33);
  const bubbleTop = Math.round(scene * 0.45);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <StepHeader onBack={onBack} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: space.lg + 4, paddingTop: space.lg, gap: space.xl }}
        showsVerticalScrollIndicator={false}
      >
        <StepHeading title={"Your agents\nare on it."} body="Get notified when your result is ready." />

        <View style={{ alignItems: "center", gap: space.lg }}>
          <View
            style={{
              width: scene,
              height: scene,
              borderRadius: 30,
              overflow: "hidden",
              backgroundColor: isDark ? "#1B1F19" : "#F5EFE3",
            }}
          >
            <Image
              source={isDark ? plates.large.dark : plates.large.light}
              style={{ position: "absolute", top: 0, left: 0, width: scene, height: scene }}
              resizeMode="cover"
            />
            {/* Laid over the plate rather than baked into it: the plates are
                clean on purpose, so a caption and a bubble drawn here cannot
                end up duplicated by artwork that already contains them. */}
            <Text
              style={{
                position: "absolute",
                top: space.lg,
                left: space.lg,
                ...type.headline,
                color: isDark ? "#F2F0EA" : "#2B2A26",
              }}
            >
              {runningCount === 1 ? "1 working" : `${runningCount} working`}
            </Text>
            <View
              style={{
                position: "absolute",
                left: bubbleLeft,
                top: bubbleTop,
                maxWidth: Math.round(scene * 0.5),
                backgroundColor: isDark ? "#1B1F19" : "#FFFFFF",
                borderRadius: radius.sm,
                paddingHorizontal: 6,
                paddingVertical: 3,
                gap: 1,
              }}
            >
              <Text numberOfLines={1} style={{ fontSize: 10, fontWeight: "600", lineHeight: 11, color: colors.text }}>
                {title}
              </Text>
              <Text style={{ fontSize: 9, lineHeight: 10, color: colors.textMuted }}>now</Text>
            </View>
            <Image
              source={agentIcon(agent)}
              style={{ position: "absolute", left: bubbleLeft + 14, top: bubbleTop + 34, width: 30, height: 30, borderRadius: 7 }}
            />
          </View>

          {/* What the notification will look like, so "Notify me" is a
              choice about something concrete and not a permission dialog. */}
          <View
            style={{
              alignSelf: "stretch",
              flexDirection: "row",
              alignItems: "center",
              gap: space.md,
              padding: 14,
              borderRadius: 24,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              shadowColor: "#000",
              shadowOpacity: 0.06,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 4 },
            }}
          >
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: isDark ? colors.cardPressed : "#FAF4EF",
              }}
            >
              <Image source={agentIcon(agent)} style={{ width: 30, height: 30, borderRadius: 7 }} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ ...type.callout, fontWeight: "600", color: colors.text }}>Your result is ready</Text>
              <Text style={{ ...type.subhead, fontWeight: "400", color: colors.textMuted }}>Tap to continue your chat.</Text>
            </View>
            <Text style={{ ...type.caption, fontWeight: "400", color: colors.textMuted }}>now</Text>
          </View>
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: space.lg + 4, paddingTop: space.lg, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
        <PrimaryAction label="Notify me" onPress={onNotify} />
        <SecondaryAction label="Not now" onPress={onSkip} />
      </View>
    </View>
  );
}
