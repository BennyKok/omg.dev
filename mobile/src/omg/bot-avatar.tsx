/**
 * A bot's avatar — the real mascot, ported instead of faked.
 *
 * The web's `BotAvatar` (web/src/components/BotAvatar.tsx) is a hand-rolled
 * SVG creature: a 12-point radial silhouette that morphs between five shapes
 * (circle/squircle/teardrop/pebble/hexagon) and breathes on a shared rAF
 * loop, painted with one of five gradient "colorways." This used to render
 * as a flat gradient square with the shape dropped entirely — see git log
 * on this file for that first cut and its reasoning. The shape now survives
 * too, as a rasterised PNG (bot-icons.ts / scripts/generate-bot-avatars.ts),
 * the same trick agent-icons.ts already uses for the nine coding-agent
 * marks: this app has no react-native-svg and cannot take on a native
 * module without an EAS rebuild, so the silhouette ships as a bitmap
 * instead of the web's live SVG path.
 *
 * WHAT STILL DOESN'T SURVIVE: the breathing wobble, the shape-morph tween,
 * the blink, and the three non-idle motion states (thinking/working/
 * sleeping) with their own pupil positions. A PNG is one frame; the web's
 * `state="idle"` frame is the one captured, because idle applies no radii
 * distortion to the shape's rest geometry (see the generator script's
 * header). "working" keeps its existing native-only signal instead — the
 * pulsing amber dot below, the same device SessionStatusDot already uses.
 *
 * THE PLATE IS STILL A ROUNDED SQUARE, ON PURPOSE, AND THAT PART DID NOT
 * CHANGE. Every session/agent mark on this app (`AgentAvatar`,
 * components.tsx) is already circular — full `borderRadius: size / 2` — so
 * a circular bot avatar would carry no distinguishing signal here; a bot row
 * has to look different from a session row before you even read the text.
 * On the web that break is "circular vs. `rounded-md`" (spec.md §0.5); on
 * this app it runs the other way — a rounded square is the shape no other
 * avatar here uses. That call survives this change untouched. What changes
 * is what sits ON the plate: instead of the plate itself carrying the
 * colorway gradient edge-to-edge, the plate goes neutral (`colors.secondary`,
 * mirroring `AgentAvatar`'s disc) and the creature mark — which now carries
 * both shape AND colorway, baked into the PNG — sits inset on top of it, at
 * the same 0.62 mark-to-container ratio AgentAvatar uses. Painting the
 * gradient on both the plate and the mark had the two fight each other the
 * exact way AgentAvatar's own doc comment warns about ("tinting the disc
 * fought the icon"); keeping the plate neutral lets the mark carry the
 * identity once instead of twice.
 */

import { Image, View } from "react-native";
import Reanimated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

import { useTheme } from "./theme";
import type { BotColorway, BotShape } from "./bots";
import { botIcon } from "./bot-icons";

/**
 * The corner radius that reads as "rounded square" rather than "circle" or
 * "sharp card" at avatar sizes — proportional to size so it holds up at both
 * the roster's 44pt and the New/Edit Bot sheet's 64pt preview.
 */
const SQUIRCLE_RATIO = 0.32;

/** Mirrors AgentAvatar's mark-to-disc ratio (components.tsx) — leaves the
 * plate a margin so the mark reads as sitting on it, not as a sticker
 * covering it edge to edge. */
const MARK_RATIO = 0.62;

export function BotAvatar({
  shape,
  colorway,
  size = 44,
  working = false,
  style,
}: {
  shape?: BotShape | null;
  colorway?: BotColorway | null;
  size?: number;
  /** Same warning-amber pulsing dot as SessionStatusDot's busy state. */
  working?: boolean;
  style?: object;
}) {
  const { colors } = useTheme();
  const radius = Math.round(size * SQUIRCLE_RATIO);
  const markSize = Math.round(size * MARK_RATIO);

  const pulse = useSharedValue(1);
  if (working) {
    pulse.value = withRepeat(withTiming(0.5, { duration: 1000 }), -1, true);
  } else {
    pulse.value = 1;
  }
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const dotSize = Math.max(10, Math.round(size * 0.27));

  return (
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: colors.secondary,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <Image
          source={botIcon(shape, colorway)}
          style={{ width: markSize, height: markSize }}
          resizeMode="contain"
        />
      </View>
      {working ? (
        <Reanimated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              right: -1,
              bottom: -1,
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: colors.warning,
              borderWidth: 2,
              borderColor: colors.card,
            },
            pulseStyle,
          ]}
        />
      ) : null}
    </View>
  );
}
