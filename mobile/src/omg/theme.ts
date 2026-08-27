/**
 * The Computer's visual language, resolved for the device's current appearance.
 *
 * The tokens themselves live in palette.ts (no platform imports, so tooling can
 * read them). This module is the thin React layer on top.
 *
 * It follows the DEVICE, not a hardcoded scheme. app.json declares
 * userInterfaceStyle "automatic" and the web toggles its `.dark` class off the
 * OS preference, so a phone in light mode has to get the light palette or the
 * two surfaces stop being the same product. The old prototype hardcoded black
 * and looked wrong in daylight.
 */

import { useColorScheme } from "react-native";

import {
  dark,
  light,
  motion,
  radius,
  space,
  type as typeScale,
  type OmgColors,
} from "./palette";

export * from "./palette";

export type OmgTheme = {
  colors: OmgColors;
  isDark: boolean;
  radius: typeof radius;
  space: typeof space;
  type: typeof typeScale;
  motion: typeof motion;
};

/**
 * The theme for the device's CURRENT appearance. `useColorScheme` re-renders on
 * an OS appearance change, so this tracks someone flipping the system toggle
 * (or Night Shift) live, with no app restart.
 *
 * `null` means "no preference expressed" — treated as light, matching how the
 * web only adds `.dark` when the preference is explicitly dark.
 */
export function useTheme(): OmgTheme {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  return {
    colors: isDark ? dark : light,
    isDark,
    radius,
    space,
    type: typeScale,
    motion,
  };
}
