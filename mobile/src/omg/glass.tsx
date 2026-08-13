/**
 * Liquid Glass, with an honest fallback.
 *
 * `GlassView` only actually frosts on iOS 26+; `isLiquidGlassAvailable()` is
 * false everywhere else, and there the component renders as a plain view with
 * no background at all. A composer bar that silently loses its background is
 * worse than one that never had glass, so this wrapper always supplies a solid
 * surface underneath and lets the glass sit on top when the OS can draw it.
 *
 * Checked once at module scope rather than per render: it is a static property
 * of the OS, and calling it in a hot list row is wasted work.
 */

import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";

/**
 * Checked once at module scope rather than per render: it is a static property
 * of the OS, and calling it in a hot list row is wasted work.
 *
 * Guarded because this runs at IMPORT time. Any host without the native side
 * compiled in — Expo Go on an SDK whose client predates the module, a dev
 * client built before it was added — throws here, and a throw at module scope
 * takes the whole bundle down as a white screen with no usable error. Falling
 * back to "no glass" degrades to the solid surface everything already has.
 */
export const LIQUID_GLASS = (() => {
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

export function GlassSurface({
  children,
  style,
  /** Solid colour used when the OS cannot draw glass. */
  fallbackColor,
  /** 'clear' for chrome floating over content, 'regular' for panels. */
  variant = "regular",
  tintColor,
}: {
  children?: ReactNode;
  style?: ViewStyle;
  fallbackColor: string;
  variant?: "clear" | "regular";
  tintColor?: string;
}) {
  if (!LIQUID_GLASS) {
    return <View style={[style, { backgroundColor: fallbackColor }]}>{children}</View>;
  }
  return (
    <GlassView style={style} glassEffectStyle={variant} tintColor={tintColor}>
      {children}
    </GlassView>
  );
}
