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
  /**
   * THE iOS GROUPED-LIST SURFACES, for Settings and the screens reached from
   * it. Separate from `background`/`card` on purpose.
   *
   * Apple's grouped list is a pure-black page with a #1C1C1E card on it: a
   * delta of 28. Our `background` is #141414 and `card` was deliberately
   * raised to #242428 so a SessionCard would sit far enough above it (see the
   * note on `card`), a delta of 16. Copying #1C1C1E onto `card` would undo
   * that decision for every surface in the app, and dropping `background` to
   * black would change Home. So the grouped list gets its own pair, measured
   * from Settings on iOS 26 (iPhone 17 Pro, both appearances), and the rest of
   * the app keeps the surfaces it was tuned for.
   */
  groupedBackground: string;
  groupedCard: string;
  /** Measured; a real separator is lighter than our general-purpose `border`. */
  groupedSeparator: string;
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
  /**
   * Skeleton placeholder fill, and the highlight that sweeps across it.
   *
   * NATIVE-ONLY, like `fieldFill`: there is no matching custom property in
   * index.css, so these are absent from check-theme-drift's MAP on purpose.
   *
   * They are TRANSLUCENT rather than flat hexes. A bone always sits on `card`
   * today, but the same primitive is the obvious thing to reach for on a sheet
   * or a popover, and an alpha keeps the separation constant wherever it
   * lands. `secondary` used to play this role and it is a flat colour chosen
   * to sit BESIDE card, not on it: #2c2c2e on #242428 is 8 levels of
   * separation, about 1.2:1, which measured as an almost invisible bone on
   * device. Light was worse — #f9f9fb on #ffffff, 6 levels.
   */
  skeletonBone: string;
  skeletonSweep: string;
};

/**
 * Dark tokens — from `.dark` in web/src/index.css.
 *
 * Softened off the original near-black/pure-white extremes at Benny's
 * request (2026-08-17), grounded in pixel samples off Claude's iOS app —
 * see the inline notes on background/foreground/card/mutedForeground below
 * for the measurements and reasoning. web/src/index.css's `.dark` block was
 * updated to match in the same change; scripts/check-theme-drift.ts is green.
 */
export const darkColors: Palette = {
  // Softened off near-black. Measured from Benny's Claude-iOS reference
  // screenshots (ImageMagick pixel sample, averaged over several clean
  // patches): background ~#141414, card fill ~#1F1F1F. See the note on
  // `card` below for how that measured card value ended up not being the
  // final one.
  background: "#141414",
  // Off-white, not pure white. Reference chat titles and assistant body text
  // both measured ~#F8F8F6-#F9F9F7 (warm: R/G a few points above B).
  // #F2F2ED sits a little further back from white than the raw measurement,
  // as safety margin, while keeping the same warm R=G>B relationship.
  foreground: "#F2F2ED",
  // Bumped from #1c1c1e per Benny — the card itself (SessionCard, message
  // bubbles, everything using `colors.card`) needed to sit further above the
  // new lighter bg, not just gain a border (that's PR #132's borderStrong,
  // a different fix for a different surface). #242428: delta from bg goes
  // from 8 to 16-20 — a real, visible raise, still short of the old
  // 28-level jump off pure black so it doesn't blow past the reference's
  // own bg->card gap (~11). `popover` moves with it (same surface family);
  // `fieldFill` is left at the old #1c1c1e — untouched by this request, and
  // only used on the sign-in screen.
  groupedBackground: "#000000",
  groupedCard: "#1c1c1e",
  groupedSeparator: "#38383b",
  card: "#242428",
  cardPressed: "#2c2c2e",
  popover: "#242428",
  secondary: "#2c2c2e",
  muted: "#2c2c2e",
  // Same alpha-over-background formula as before (0.6), but the base tint
  // moves from a cool white (235,235,245) to a warm one (235,230,220) so the
  // composited result lands on the measured reference grey — "last mo." in
  // the chats-list reference sampled at #96948D (150,148,141), a clearly
  // warm grey (R notably above B). Composited here: ~(149,146,140).
  mutedForeground: "rgba(235, 230, 220, 0.6)",
  accent: "rgba(118, 118, 128, 0.24)",
  primary: "#0a84ff",
  primaryForeground: "#ffffff",
  destructive: "#ff453a",
  success: "#30d158",
  warning: "#ff9f0a",
  info: "#0a84ff",
  border: "rgba(84, 84, 88, 0.35)",
  borderStrong: "rgba(84, 84, 88, 0.65)",
  // Same warm base as mutedForeground, same relative alpha step (0.78,
  // unchanged from before) — one tier up from mutedForeground, same as it
  // always was. No reference sample exists for this exact tier (the refs
  // only show a title/timestamp pair), so this moves with the rest of the
  // system rather than being independently measured.
  text2: "rgba(235, 230, 220, 0.78)",
  codeBg: "rgba(118, 118, 128, 0.16)",
  /** Elevated fill for a field sitting on `card`. */
  fieldFill: "#1c1c1e",
  // Same warm base as mutedForeground/text2. On `card` (36,36,40) these
  // composite to roughly (56,55,58) and (92,90,92): the bone reads as a
  // placeholder at a glance, and the sweep is clearly brighter than it.
  skeletonBone: "rgba(235, 230, 220, 0.10)",
  skeletonSweep: "rgba(235, 230, 220, 0.20)",
};

/** Light tokens — from `:root` in web/src/index.css. */
export const lightColors: Palette = {
  background: "#f2f2f7",
  foreground: "#000000",
  groupedBackground: "#f2f2f7",
  groupedCard: "#ffffff",
  groupedSeparator: "#e8e8e8",
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
  // Same base as light's mutedForeground. On white these composite to about
  // (237,237,238) and (205,205,208).
  skeletonBone: "rgba(60, 60, 67, 0.09)",
  skeletonSweep: "rgba(60, 60, 67, 0.18)",
};

/**
 * THE LANDING PAGE'S OWN SURFACE, for the launch screen only.
 *
 * Benny asked for the splash to look like omg.dev, so these are not invented:
 * they are the landing stylesheet's `:root` and `.dark` custom properties,
 * read on 2026-09-12 from
 * .../web/landing/1de05cf82745300d600e2eeefabe884f54cacb53/assets/styles.css
 * — `--background`, `--foreground`, `--muted-foreground` and `--brand`.
 *
 * SEPARATE FROM `Palette` ON PURPOSE, and not in check-theme-drift's MAP. The
 * app's own palette mirrors web/src/index.css, which is the DASHBOARD's token
 * set — a different surface with a different background. Folding the marketing
 * cream into `colors.bg` would re-skin every screen in the app. This is one
 * screen quoting another product surface, so it stays a named island.
 *
 * The landing's brand radial glow was copied here too and then removed at
 * Benny's request, so `--brand` is no longer among these: the launch surface
 * is one flat colour and the only brand on it is the mark itself.
 */
export const launch = {
  light: {
    bg: "#f0ede7",
    text: "#0d0c0a",
    textMuted: "#65605a",
  },
  dark: {
    bg: "#060505",
    text: "#ffffff",
    textMuted: "#c4beb4",
  },
} as const;

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

// `group` is the iOS 26 grouped-list card. Measured at 64px on a 3x device.
// `tile` is the settings icon tile (web: rounded-[9px] on a 32px square).
export const radius = { sm: 8, tile: 9, md: 10, lg: 12, xl: 18, group: 22, pill: 999 } as const;

/**
 * Fixed control sizes from the web restyle of 2026-10-03/04. Named here so a
 * screen never hardcodes them.
 *
 * - `pill`: a starter pill (web chat-starter-row: h-9).
 * - `row`: a one-line update row (web auto-report-row: h-9).
 * - `tile`: a settings icon tile (web settings-screen: h-8 w-8).
 * - `meter`: a plan usage bar (web settings-screen: h-1.5).
 * - `headerFade`: how far a transcript fades in under a rule-less header
 *   (web `.chat-stream-fade`: 1.5rem).
 */
export const control = { pill: 36, row: 36, tile: 32, meter: 6, headerFade: 24 } as const;

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
  /**
   * The gradient-edged field (web `.lfg-gfield`): a 1px edge that runs at
   * 160deg through four stops of the foreground, at rest and on focus. Focus
   * brightens the same neutral edge. There is no accent ring. Use with
   * `fieldEdgeStops` as the gradient locations.
   */
  fieldEdge: readonly [string, string, string, string];
  fieldEdgeFocus: readonly [string, string, string, string];
  /** Settings icon tile fill (web `bg-foreground/[0.05]`). */
  tileFill: string;
  /** Plan usage bar track (web `bg-foreground/10`). */
  meterTrack: string;
  /** Plan usage bar fill when the credit is low or every agent is busy. */
  meterLow: string;
  /** "Running low" and "All in use" text (web amber-700, dark amber-300). */
  meterLowText: string;
  /** Icon colour per chat starter (web STARTER_TINTS: 500, dark 400). */
  starter: { website: string; app: string; api: string; image: string };
};

/** Gradient locations for `fieldEdge` and `fieldEdgeFocus`. */
export const fieldEdgeStops = [0, 0.44, 0.72, 1] as const;

/** `#rrggbb` at an alpha, as rgba(). The web writes these as color-mix. */
function alpha(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Tailwind v4 palette, oklch converted to sRGB.
const tw = {
  amber300: "#ffd230",
  amber400: "#ffb900",
  amber500: "#fe9a00",
  amber700: "#bb4d00",
  sky400: "#00bcff",
  sky500: "#00a6f4",
  emerald400: "#00d492",
  emerald500: "#00bc7d",
  pink400: "#fb64b6",
  pink500: "#f6339a",
} as const;

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
    // Derived from `foreground`, so these follow the synced token and cannot
    // drift from it on their own.
    fieldEdge: [0.24, 0.08, 0.04, 0.14].map((a) => alpha(base.foreground, a)) as unknown as OmgColors["fieldEdge"],
    fieldEdgeFocus: [0.4, 0.16, 0.1, 0.26].map((a) => alpha(base.foreground, a)) as unknown as OmgColors["fieldEdgeFocus"],
    tileFill: alpha(base.foreground, 0.05),
    meterTrack: alpha(base.foreground, 0.1),
    meterLow: tw.amber500,
    meterLowText: isDark ? tw.amber300 : tw.amber700,
    starter: isDark
      ? { website: tw.sky400, app: tw.emerald400, api: tw.amber400, image: tw.pink400 }
      : { website: tw.sky500, app: tw.emerald500, api: tw.amber500, image: tw.pink500 },
  };
}

export const dark = withAliases(darkColors, true);
export const light = withAliases(lightColors, false);
