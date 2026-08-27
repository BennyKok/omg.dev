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
