/**
 * A bot's avatar — deliberately NOT the web's mark.
 *
 * The web's `BotAvatar` (web/src/components/BotAvatar.tsx) is a hand-rolled
 * SVG creature: a 12-point radial silhouette that morphs between five shapes
 * (circle/squircle/teardrop/pebble/hexagon) and breathes on a shared rAF
 * loop, painted with one of five gradient "colorways." It supersedes the
 * older emoji-avatar design in docs/design/bot-mode/spec.md, which is why
 * this file exists instead of an emoji box.
 *
 * PORTING THE SILHOUETTE ITSELF IS OUT OF SCOPE, ON PURPOSE. It needs
 * arbitrary SVG path drawing, and this app has no `react-native-svg` and
 * cannot take on a native module without an EAS rebuild — see
 * agent-icons.ts's identical reasoning for why agent marks ship as PNGs
 * instead of the web's SVGs. `expo-linear-gradient` IS already a dependency
 * (used by the home composer's fade), so the colorway half of the identity
 * survives losslessly; the shape half — five distinct silhouettes — does
 * not, and is deliberately deferred rather than faked with a worse-looking
 * stand-in. `shape` still round-trips through bots.ts so no data is lost;
 * only the rendering is simplified. Revisit if Benny wants the five shapes
 * distinguished on native — the honest options then are a small bundled PNG
 * per shape (same trick as agent-icons.ts) or taking the react-native-svg
 * native-module cost deliberately, not a pure-RN geometry hack standing in
 * for five hand-tuned silhouettes.
 *
 * THE SHAPE THAT SURVIVES THE PORT IS THE ONE THAT CARRIES MEANING: a bot
 * reads as a bot, not a session, at a glance. On the web that meaning is
 * "circular vs. `rounded-md`" (spec.md §0.5). On THIS app every session/agent
 * mark (`AgentAvatar`, components.tsx) is already circular — full
 * `borderRadius: size / 2` — so a circular bot avatar would carry no
 * distinguishing signal here at all; it would look identical to a session
 * row. The break has to run the other way on this surface: a bot avatar is a
 * ROUNDED SQUARE (a "squircle" corner radius, not a full round), which is
 * the one shape no existing avatar in this app uses. The meaning survives —
 * bot rows are still shape-distinct from session rows on sight — even though
 * the specific shape is inverted from the web's choice.
 *
 * The colorway gradient runs diagonally (top-left to bottom-right), matching
 * the web's `gradientUnits="userSpaceOnUse" x1=18 y1=18 x2=182 y2=182` on a
 * 200x200 viewBox — the same corner-to-corner direction, just without the
 * silhouette clipping it.
 */

import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Reanimated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

import { useTheme } from "./theme";
import type { BotColorway } from "./bots";

/** Mirrors COLORWAYS in web/src/components/BotAvatar.tsx — literal design values, not CSS. */
const COLORWAY_STOPS: Record<BotColorway, [string, string]> = {
  warm: ["#f0a04b", "#b4451f"],
  brand: ["#4d7cff", "#06b6d4"],
  violet: ["#8b5cf6", "#ec4899"],
  forest: ["#14b8a6", "#84cc16"],
  midnight: ["#7b8ba6", "#2b3446"],
};

/** Same default the web falls back to for a bot with no colorway chosen yet. */
const DEFAULT_COLORWAY: BotColorway = "warm";

/**
 * The corner radius that reads as "rounded square" rather than "circle" or
 * "sharp card" at avatar sizes — proportional to size so it holds up at both
 * the roster's 28pt mark and a later chat-header size.
 */
const SQUIRCLE_RATIO = 0.32;

export function BotAvatar({
  colorway = DEFAULT_COLORWAY,
  size = 28,
  working = false,
  style,
}: {
  colorway?: BotColorway;
  size?: number;
  /** Same warning-amber pulsing dot as SessionStatusDot's busy state. */
  working?: boolean;
  style?: object;
}) {
  const { colors } = useTheme();
  const [start, end] = COLORWAY_STOPS[colorway] ?? COLORWAY_STOPS[DEFAULT_COLORWAY];
  const radius = Math.round(size * SQUIRCLE_RATIO);

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
      <LinearGradient
        colors={[start, end]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: size, height: size, borderRadius: radius }}
      />
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
