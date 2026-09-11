/**
 * THE EDGE FADE: the page colour dissolving over scrolling content at a
 * screen edge, so rows pass under the chrome instead of hitting a hard line.
 *
 * It began as the Live view's composer fade (bottom edge). Now the top of
 * Live and both edges of the chat use the same paint, so a transcript slides
 * under the bar the way it slides under the composer.
 */
import { LinearGradient } from "expo-linear-gradient";
import type { StyleProp, ViewStyle } from "react-native";

import { withAlpha } from "../components";

/** How far past the chrome the dissolve runs before the content is fully visible. */
export const TOP_FADE_HEIGHT = 56;

/**
 * How far above a composer the scroll content starts dissolving.
 *
 * Borrowed from Claude's iOS app: the transcript doesn't stop at a hard edge
 * above the input bar, it fades into the page background first, so scrolling
 * text never collides with the glass. 120pt is roughly two lines of body text
 * plus breathing room — enough to read as a dissolve, not so much that the
 * last visible row looks half-erased.
 */
export const COMPOSER_FADE_HEIGHT = 120;

/**
 * Gradient stops for an edge fade, eased rather than linear.
 *
 * A straight transparent-to-opaque ramp reads as a flat grey smudge sliding
 * over the content — the eye is very sensitive to linear alpha ramps. These
 * stops follow an ease-in curve (roughly t^2, sampled at six points) so the
 * fade starts almost imperceptibly and only does most of its work in the
 * last third, next to the chrome itself. `hex` is always `colors.bg` — a
 * plain hex token, never an rgba string — so `withAlpha` can parse it.
 *
 * "bottom": transparent at the top, opaque at the bottom (above a composer).
 * "top": opaque at the top, transparent at the bottom (below a bar).
 */
export function fadeStops(
  hex: string,
  edge: "top" | "bottom" = "bottom",
): {
  colors: [string, string, ...string[]];
  locations: [number, number, ...number[]];
} {
  const steps: Array<[number, number]> = [
    [0, 0],
    [0.15, 0.02],
    [0.35, 0.12],
    [0.55, 0.3],
    [0.75, 0.56],
    [1, 1],
  ];
  /**
   * The top edge holds fully opaque through the status bar first: the clock
   * and the battery sit on it, and a row half-read under the time is worse
   * than no row at all. The dissolve starts under the bar proper.
   */
  const top: Array<[number, number]> = [
    [0, 1],
    [0.3, 1],
    [0.5, 0.72],
    [0.7, 0.36],
    [0.85, 0.12],
    [1, 0],
  ];
  const ordered = edge === "top" ? top : steps;
  return {
    locations: ordered.map(([location]) => location) as [number, number, ...number[]],
    colors: ordered.map(([, alpha]) => withAlpha(hex, alpha)) as [string, string, ...string[]],
  };
}

/** The fade as a view. Paint only: it never takes a touch. */
export function EdgeFade({
  edge,
  color,
  style,
}: {
  edge: "top" | "bottom";
  color: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <LinearGradient
      pointerEvents="none"
      {...fadeStops(color, edge)}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={style}
    />
  );
}
