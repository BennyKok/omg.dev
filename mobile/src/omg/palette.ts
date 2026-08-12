/**
 * The raw design tokens, with no platform imports.
 *
 * Split out from theme.ts on purpose: theme.ts pulls in react-native for
 * `useColorScheme`, and anything that imports react-native can only run inside
 * Metro. The drift checker is an ordinary Bun script, and design tokens have no
 * business depending on a UI runtime to be readable.
 *
 * Values are lifted from web/src/index.css — `:root` for light, `.dark` for
 * dark — and scripts/check-theme-drift.ts fails the build if they stop
 * matching.
 */

/**
 * One scheme's worth of tokens. Declared as an explicit type rather than
 * inferred from the dark palette with `as const`: that inference makes every
 * value a string LITERAL, so the light palette then fails to typecheck for the
 * crime of being a different colour.
 */
export type Palette = {
  background: string;
  foreground: string;
  card: string;
  cardPressed: string;
  popover: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  success: string;
  warning: string;
  info: string;
  border: string;
  borderStrong: string;
  text2: string;
  codeBg: string;
  /** Elevated fill for a field sitting on `card`. */
  fieldFill: string;
};

/** Dark tokens — from `.dark` in web/src/index.css. */
export const darkColors: Palette = {
  background: "#000000",
  foreground: "#ffffff",
  card: "#1c1c1e",
  cardPressed: "#2c2c2e",
  popover: "#1c1c1e",
  secondary: "#2c2c2e",
  muted: "#2c2c2e",
  mutedForeground: "rgba(235, 235, 245, 0.6)",
  accent: "rgba(118, 118, 128, 0.24)",
  primary: "#0a84ff",
  primaryForeground: "#ffffff",
  destructive: "#ff453a",
  success: "#30d158",
  warning: "#ff9f0a",
  info: "#0a84ff",
  border: "rgba(84, 84, 88, 0.35)",
  borderStrong: "rgba(84, 84, 88, 0.65)",
  text2: "rgba(235, 235, 245, 0.78)",
  codeBg: "rgba(118, 118, 128, 0.16)",
  /** Elevated fill for a field sitting on `card`. */
  fieldFill: "#1c1c1e",
};

/** Light tokens — from `:root` in web/src/index.css. */
export const lightColors: Palette = {
  background: "#f2f2f7",
  foreground: "#000000",
  card: "#ffffff",
  cardPressed: "#f2f2f7",
  popover: "#ffffff",
  secondary: "#f9f9fb",
  muted: "#f9f9fb",
  mutedForeground: "rgba(60, 60, 67, 0.6)",
  accent: "rgba(120, 120, 128, 0.12)",
  primary: "#007aff",
  primaryForeground: "#ffffff",
  destructive: "#ff3b30",
  success: "#34c759",
  warning: "#ff9500",
  info: "#007aff",
  border: "rgba(60, 60, 67, 0.12)",
  borderStrong: "rgba(60, 60, 67, 0.29)",
  text2: "#3c3c43",
  codeBg: "rgba(120, 120, 128, 0.08)",
  fieldFill: "#ffffff",
};

/**
 * omg brand. Deliberately scheme-independent and NOT part of the shared token
 * set: the web surface is chrome-less inside the dashboard and takes brand from
 * its host, whereas the app IS the chrome and needs its own mark.
 */
export const brand = {
  orange: "#FF5530",
  ink: "#060505",
  inkRaised: "#211C17",
} as const;

export const radius = { sm: 8, md: 10, lg: 12, xl: 18, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/**
 * Type scale, named for iOS Dynamic Type so intent survives. Sizes are pinned
 * rather than scaled: the session list has to stay dense enough to read a fleet
 * at a glance. Screens showing user prose should still allow OS scaling — pass
 * `allowFontScaling` on those specific Text nodes.
 */
export const type = {
  largeTitle: { fontSize: 34, fontWeight: "700", letterSpacing: -0.4 },
  title: { fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  headline: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2 },
  body: { fontSize: 16, fontWeight: "400" },
  callout: { fontSize: 15, fontWeight: "400" },
  subhead: { fontSize: 14, fontWeight: "500" },
  footnote: { fontSize: 13, fontWeight: "400" },
  caption: { fontSize: 12, fontWeight: "500", letterSpacing: 0.2 },
  overline: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
} as const;

/** Mirrored from index.css's duration/easing scale. */
export const motion = {
  micro: 80,
  quick: 150,
  fast: 250,
  medium: 350,
  slow: 400,
  easeSmoothOut: [0.22, 1, 0.36, 1] as const,
  easeBounce: [0.34, 1.36, 0.64, 1] as const,
} as const;

export type OmgColors = Palette & {
  brand: string;
  bg: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  borderSoft: string;
  danger: string;
  done: string;
  /** Agent is working. Same green as success — "running" is a good state. */
  busy: string;
  accentSoft: string;
};

function withAliases(base: Palette, isDark: boolean): OmgColors {
  return {
    ...base,
    brand: brand.orange,
    bg: base.background,
    text: base.foreground,
    textSecondary: base.text2,
    textMuted: base.mutedForeground,
    borderSoft: base.border,
    danger: base.destructive,
    done: base.success,
    busy: base.success,
    accentSoft: isDark ? "rgba(10, 132, 255, 0.16)" : "rgba(0, 122, 255, 0.12)",
  };
}

export const dark = withAliases(darkColors, true);
export const light = withAliases(lightColors, false);
