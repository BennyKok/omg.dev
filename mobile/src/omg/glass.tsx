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
import { forwardRef, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

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

/**
 * `forwardRef`, and `StyleProp<ViewStyle>` rather than a bare `ViewStyle`, so
 * this can be wrapped by `Reanimated.createAnimatedComponent`.
 *
 * Reanimated drives an animated component by getting a ref to its underlying
 * host view and writing straight to it, and it passes the animated style down
 * as an opaque style object. Without the ref it silently animates nothing;
 * without the wider style type an animated style will not type-check. The
 * composer morph is the first caller that needs either.
 */
export const GlassSurface = forwardRef<View, {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Solid colour used when the OS cannot draw glass. */
  fallbackColor: string;
  /** 'clear' for chrome floating over content, 'regular' for panels. */
  variant?: "clear" | "regular";
  tintColor?: string;
}>(function GlassSurface({ children, style, fallbackColor, variant = "regular", tintColor }, ref) {
  if (!LIQUID_GLASS) {
    return <View ref={ref} style={[style, { backgroundColor: fallbackColor }]}>{children}</View>;
  }
  return (
    <GlassView ref={ref as never} style={style} glassEffectStyle={variant} tintColor={tintColor}>
      {children}
    </GlassView>
  );
});
