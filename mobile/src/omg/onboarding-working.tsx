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
import { useState } from "react";
import { Image, View } from "react-native";
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
  /** The task they wrote, shown in the bubble. */
  title: string;
  agent: string;
  runningCount: number;
  onNotify: () => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const { colors, isDark, radius, space, type } = useTheme();
  const insets = useSafeAreaInsets();
  const plates = backgroundsFor("blossom");
  /** Measured, because the plate under it is pinned to the space that is left. */
  const [headingHeight, setHeadingHeight] = useState(0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <StepHeader onBack={onBack} />
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: space.lg + 4 }} onLayout={(e) => setHeadingHeight(e.nativeEvent.layout.height)}>
          <StepHeading title={"Your agents\nare on it."} body="Get notified when your result is ready." />
        </View>

        {/*
         * THE PLATE IS PINNED, top AND bottom, and that is deliberate.
         *
         * Sized in normal flow it was not the height of the space left under
         * the heading: it took the artwork's own dimensions, ran off the
         * bottom of a 6.3" screen, and the buttons ended up drawn over it.
         * Every ordinary remedy was tried on the device -- `flex: 1` on the
         * box, `flex: 1` on the image, an absolutely filled image, `minHeight:
         * 0` -- and the card stayed about 1450pt tall in all of them, which is
         * the artwork's pixel height. A colour probe with the image removed
         * laid out correctly, so the image was the thing setting the height.
         *
         * With both `top` and `bottom` fixed, the height comes only from the
         * parent and nothing inside can change it. The heading is measured
         * because it is the only part above that is not a constant: two lines
         * of large title is not the same height on every text size.
         *
         * The art is a backdrop, not a diagram, so `cover` cropping it is
         * correct. The caption and the bubble are then placed against a box
         * that is actually on screen.
         */}
        <View
          style={{
            position: "absolute",
            top: headingHeight + space.lg,
            left: space.lg + 4,
            right: space.lg + 4,
            bottom: 0,
            borderRadius: radius.xl,
            overflow: "hidden",
          }}
        >
          <Image
            source={isDark ? plates.large.dark : plates.large.light}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            resizeMode="cover"
          />

          {/* Laid over the plate rather than baked into it -- the plates are
              clean on purpose, so a caption and a bubble drawn here cannot end
              up duplicated by artwork that already contains them. */}
          <View style={{ position: "absolute", top: space.lg, left: space.lg }}>
            <Text style={{ ...type.title, color: isDark ? "#F2F0EA" : "#2B2A26" }}>
              {runningCount === 1 ? "1 working" : `${runningCount} working`}
            </Text>
          </View>
          <View
            style={{
              position: "absolute",
              left: space.lg,
              right: space.lg,
              top: "44%",
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <Image source={agentIcon(agent)} style={{ width: 30, height: 30, borderRadius: 7 }} />
            <View
              style={{
                flex: 1,
                backgroundColor: isDark ? "#1B1F19" : "#FFFFFF",
                borderRadius: radius.md,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
              }}
            >
              <Text numberOfLines={1} style={{ ...type.subhead, color: colors.text }}>{title}</Text>
              <Text style={{ ...type.caption, color: colors.textMuted }}>now</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={{ paddingHorizontal: space.lg + 4, paddingTop: space.lg, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
        <PrimaryAction label="Notify me" onPress={onNotify} />
        <SecondaryAction label="Not now" onPress={onSkip} />
      </View>
    </View>
  );
}
