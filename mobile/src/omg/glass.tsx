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

export const LIQUID_GLASS = isLiquidGlassAvailable();

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
