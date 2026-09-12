/**
 * The omg mark, at any size.
 *
 * Geometry is derived from the real logo rather than eyeballed. The SVG omg
 * uses everywhere (auth emails, landing, favicon) is, in a 100x100 viewBox:
 *
 *   <circle cx="50" cy="50" r="44" fill="#FF5530" mask=…/>
 *   mask cuts <circle cx="71" cy="29" r="14"/>
 *
 * So the bite sits INSIDE the disc — up and to the right of centre, not hanging
 * off the edge. Clipping a circle to the rim instead reads as a chipped coin.
 *
 * Everything below is that ratio, scaled to `size`, where `size` is the
 * diameter of the visible disc (viewBox r=44 → d=88).
 */

import { View, type ViewStyle } from "react-native";

import { Text } from "./text";
import { useTheme } from "./theme";

const DISC_VIEWBOX_DIAMETER = 88; // r=44
const BITE_VIEWBOX_DIAMETER = 28; // r=14
/** Bite centre offset from disc centre, in viewBox units: (71,29) - (50,50). */
const BITE_OFFSET_X = 21;
const BITE_OFFSET_Y = -21;

export function BrandMark({
  size = 56,
  /**
   * Colour showing through the bite. It must match whatever is actually behind
   * the mark — the bite is a hole, and a hole filled with the wrong colour is
   * just a dot. Defaults to the screen background.
   */
  holeColor,
  color,
  style,
}: {
  size?: number;
  holeColor?: string;
  color?: string;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const scale = size / DISC_VIEWBOX_DIAMETER;
  const bite = BITE_VIEWBOX_DIAMETER * scale;
  const centre = size / 2;

  return (
    <View
      accessibilityLabel="omg"
      accessible
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color ?? colors.brand,
        },
        style,
      ]}
    >
      <View
        style={{
          position: "absolute",
          width: bite,
          height: bite,
          borderRadius: bite / 2,
          backgroundColor: holeColor ?? colors.bg,
          left: centre + BITE_OFFSET_X * scale - bite / 2,
          top: centre + BITE_OFFSET_Y * scale - bite / 2,
        }}
      />
    </View>
  );
}

/**
 * The full `omg.dev` lockup: mark, then "omg" solid and ".dev" one tier back.
 *
 * The split colour is the logo's, not a flourish — the landing header draws
 * "omg" in `--foreground` and ".dev" in a muted grey, and a wordmark that
 * paints both the same reads as a different logo.
 *
 * NOT IN GEIST. The landing sets `Geist Variable` and no Geist file is bundled
 * here (assets/fonts holds lucide.ttf and nothing else), so this is the system
 * face at weight 800 with the tracking pulled in to sit closer to it. Adding a
 * variable font to the launch path is its own change: `src/omg/lucide.tsx`
 * documents that a font which fails to load must not strand the app on its
 * splash, and that argument applies doubly to a font the splash itself needs.
 */
export function BrandWordmark({
  size = 34,
  /**
   * Draw the mark ahead of the type. Off for a caller that ALREADY shows the
   * mark — the launch screen has a 64pt one breathing directly above this, and
   * two discs one under the other reads as a rendering fault, not a lockup.
   */
  mark = true,
  color,
  mutedColor,
  holeColor,
}: {
  /** Cap height of the type. The mark is scaled to match it. */
  size?: number;
  mark?: boolean;
  color?: string;
  mutedColor?: string;
  holeColor?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: mark ? size * 0.26 : 0 }}>
      {mark ? <BrandMark size={size * 1.02} holeColor={holeColor} /> : null}
      <Text
        // The lockup is a logo, not prose: it must not grow with Dynamic Type.
        allowFontScaling={false}
        style={{
          fontSize: size,
          fontWeight: "800",
          letterSpacing: -size * 0.045,
          color: color ?? colors.text,
        }}
      >
        omg
        <Text
          allowFontScaling={false}
          style={{
            fontSize: size,
            fontWeight: "800",
            letterSpacing: -size * 0.045,
            color: mutedColor ?? colors.textSecondary,
          }}
        >
          .dev
        </Text>
      </Text>
    </View>
  );
}
