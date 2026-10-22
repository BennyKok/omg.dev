// The look of every screen, the HUD, the touch controls and the game world,
// for 2D and 3D. Restyle a game here and nowhere else.
//
//   export const theme: Theme = PRESETS.softCandy;                       // the default
//   export const theme: Theme = { ...PRESETS.softCandy, accent: "#2bb673", accentShade: "#1d8a55" };
//
// `material` picks how surfaces are built (candy: solid and tactile, glass:
// frosted and glowing, minimal: flat with thin borders). The colours are free:
// copy a customer's design colours straight into the tokens. Every token
// becomes a CSS variable (--accent, --radiusCard, ...) in page.ts, and the 2D
// and 3D views read the world colours from here too.
//
// No React and no DOM in this file (vite.config.ts reads it for the manifest).

export type Material = "candy" | "glass" | "minimal";

export type Theme = {
  material: Material;
  /** Browser form controls and the status bar follow it. */
  scheme: "light" | "dark";
  // Page
  background: string; // page colour; also the install manifest and status bar colour
  background2: string; // second colour of the page gradient
  surface: string; // cards, HUD capsules, secondary buttons
  ink: string; // main text
  muted: string; // secondary text
  line: string; // thin borders
  // Buttons
  accent: string; // primary button (Play), stick knob, highlights
  accentShade: string; // the hard shadow under the primary button
  accentInk: string; // text on accent
  accent2: string; // secondary button (Unlocks), badges
  accent2Shade: string;
  accent2Ink: string;
  // Game colours
  coin: string; // coins, stars, gems, the score badge
  danger: string; // hearts, pause button (candy), damage
  good: string;
  hazard: string; // enemies
  p1: string;
  p2: string;
  world: string; // the arena floor
  worldEdge: string; // arena walls
  worldDetail: string; // floor tiles and stones
  // Type
  fontDisplay: string; // titles, buttons, HUD numbers
  fontBody: string;
  weightHeading: number;
  weightButton: number;
  // Shape and motion
  radiusCard: number; // px
  radiusButton: number; // px
  /** px of hard shadow under buttons (candy). It shrinks when a button is pressed. */
  hardShadow: number;
  /** px a button moves down when pressed. */
  pressY: number;
  pressScale: number;
  /** px of backdrop blur on glass surfaces. 0 = solid. */
  blur: number;
  /** 0..1 neon glow on buttons and the logo. */
  glow: number;
  shadow: string; // soft shadow under cards
};

// Nunito (OFL, bundled, 39 KB) is the rounded font of Soft candy. The other
// presets use the system font stack and download no font.
const ROUNDED = '"Nunito Variable", Nunito, ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif';
const SANS = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const GEOMETRIC = '"Space Grotesk", "Avenir Next", Avenir, Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const PRESETS = {
  /** Warm cream page, coral and lavender buttons that press down. Casual phone games. The default. */
  softCandy: {
    material: "candy",
    scheme: "light",
    background: "#FFF5E8",
    background2: "#FBE7F1",
    surface: "#FFFFFF",
    ink: "#34304C",
    muted: "#7A7393",
    line: "rgba(52,48,76,0.10)",
    accent: "#FF776D",
    accentShade: "#D95350",
    accentInk: "#FFFFFF",
    accent2: "#A78BFA",
    accent2Shade: "#8062E0",
    accent2Ink: "#FFFFFF",
    coin: "#FFC84A",
    danger: "#FF5A6A",
    good: "#3CC48B",
    hazard: "#9B6BF5",
    p1: "#FF776D",
    p2: "#4AA3FF",
    world: "#BDEBD7",
    worldEdge: "#F1E4D3",
    worldDetail: "#E6F7EE",
    fontDisplay: ROUNDED,
    fontBody: ROUNDED,
    weightHeading: 900,
    weightButton: 800,
    radiusCard: 28,
    radiusButton: 24,
    hardShadow: 6,
    pressY: 4,
    pressScale: 0.98,
    blur: 0,
    glow: 0,
    shadow: "0 6px 18px rgba(73,43,73,0.10)",
  },
  /** Deep navy, frosted glass, cyan to violet glow. Night, space and arcade games. */
  glassNeon: {
    material: "glass",
    scheme: "dark",
    background: "#080D20",
    background2: "#1A1240",
    surface: "rgba(25,36,68,0.72)",
    ink: "#F7FAFF",
    muted: "#A9B4D8",
    line: "rgba(255,255,255,0.18)",
    accent: "#39E7F4",
    accentShade: "#1C8FB0",
    accentInk: "#FFFFFF",
    accent2: "#A879FF",
    accent2Shade: "#6B45C9",
    accent2Ink: "#FFFFFF",
    coin: "#FFD45A",
    danger: "#FF4D73",
    good: "#45FFAE",
    hazard: "#A64DFF",
    p1: "#39E7F4",
    p2: "#FF6FD8",
    world: "#1A2142",
    worldEdge: "#39E7F4",
    worldDetail: "#242D57",
    fontDisplay: GEOMETRIC,
    fontBody: GEOMETRIC,
    weightHeading: 700,
    weightButton: 600,
    radiusCard: 24,
    radiusButton: 20,
    hardShadow: 0,
    pressY: 0,
    pressScale: 0.96,
    blur: 20,
    glow: 1,
    shadow: "0 12px 32px rgba(0,0,0,0.32)",
  },
  /** Off-white, thin borders, one blue. Puzzle, word and learning games. */
  cleanMinimal: {
    material: "minimal",
    scheme: "light",
    background: "#F5F4F0",
    background2: "#ECEBE5",
    surface: "#FFFFFF",
    ink: "#20262E",
    muted: "#6B7280",
    line: "#E4E4DE",
    accent: "#3C63EF",
    accentShade: "#2F51CD",
    accentInk: "#FFFFFF",
    accent2: "#FFFFFF",
    accent2Shade: "#E4E4DE",
    accent2Ink: "#20262E",
    coin: "#E7B748",
    danger: "#E5484D",
    good: "#2E9E5B",
    hazard: "#9268C9",
    p1: "#3C63EF",
    p2: "#E5484D",
    world: "#ECEAE3",
    worldEdge: "#D9D6CC",
    worldDetail: "#E3E0D7",
    fontDisplay: SANS,
    fontBody: SANS,
    weightHeading: 700,
    weightButton: 600,
    radiusCard: 16,
    radiusButton: 14,
    hardShadow: 0,
    pressY: 0,
    pressScale: 0.98,
    blur: 0,
    glow: 0,
    shadow: "0 4px 16px rgba(32,38,46,0.06)",
  },
} satisfies Record<string, Theme>;

export type PresetName = keyof typeof PRESETS;

/** The preset the game starts with. Change this one name to restyle. */
export const DEFAULT_PRESET: PresetName = "softCandy";

/**
 * The theme in use. A `?theme=glassNeon` URL shows another preset, so you can
 * compare looks without editing code. Keep that line or delete it.
 */
export const theme: Theme = PRESETS[presetFromUrl() ?? DEFAULT_PRESET];

function presetFromUrl(): PresetName | null {
  if (typeof location === "undefined") return null;
  const name = new URLSearchParams(location.search).get("theme");
  return name && name in PRESETS ? (name as PresetName) : null;
}
