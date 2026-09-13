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
/**
 * THE LOCKUP'S PROPORTIONS, TAKEN FROM THE LANDING HEADER'S OWN MARKUP.
 *
 * Read on 2026-09-13 from the deployed `omg.dev` header, which renders:
 *
 *   <span style="gap:6.8px">
 *     <span style="transform:translateY(1.4px)"><svg width=16 height=16
 *        viewBox="0 0 100 100"><circle r=44 …></svg></span>
 *     <span style="font-weight:700;font-size:20px;letter-spacing:-0.045em">
 *       omg<span class="opacity-70">.dev</span></span>
 *
 * So, against the 20px type: the svg box is 16px but the VISIBLE disc is
 * r=44 of a 100 viewBox, which is 88% of 16 = 14.08px. That is the number
 * that matters, because BrandMark's `size` is the disc's diameter and not a
 * bounding box. 14.08/20 = 0.704.
 *
 * The first version of this component used 1.02, sized off the type's cap
 * height by eye, and the mark came out nearly half again too large.
 */
export const WORDMARK_MARK_RATIO = 0.704;
/** 6.8/20. */
export const WORDMARK_GAP_RATIO = 0.34;
/** 1.4/20 — the header nudges the mark down off the optical centre. */
export const WORDMARK_NUDGE_RATIO = 0.07;
/** The landing draws ".dev" as the SAME colour at 70%, not as a grey token. */
const SUFFIX_OPACITY = 0.7;

export function BrandWordmark({
  size = 34,
  /**
   * Draw the mark ahead of the type. Off for a caller that ALREADY shows the
   * mark, or one that animates the two halves separately — the launch screen
   * composes its own row so it can fly the mark out without the type.
   */
  mark = true,
  color,
  holeColor,
}: {
  /** Font size of the type. The mark is derived from it. */
  size?: number;
  mark?: boolean;
  color?: string;
  holeColor?: string;
}) {
  const { colors } = useTheme();
  const type = {
    fontSize: size,
    fontWeight: "700",
    letterSpacing: -size * 0.045,
    color: color ?? colors.text,
  } as const;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: mark ? size * WORDMARK_GAP_RATIO : 0,
      }}
    >
      {mark ? (
        <View style={{ transform: [{ translateY: size * WORDMARK_NUDGE_RATIO }] }}>
          <BrandMark size={size * WORDMARK_MARK_RATIO} holeColor={holeColor} />
        </View>
      ) : null}
      {/* The lockup is a logo, not prose: it must not grow with Dynamic Type. */}
      <Text allowFontScaling={false} style={type}>
        omg
        <Text allowFontScaling={false} style={{ ...type, opacity: SUFFIX_OPACITY }}>
          .dev
        </Text>
      </Text>
    </View>
  );
}
