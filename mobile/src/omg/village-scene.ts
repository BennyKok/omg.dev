/** Roaming centres across the grass, measured in widget points. */
export type VillageFamily = "small" | "medium" | "large";
export const VILLAGE_SCENES = {
  small: { width: 170, height: 170, slots: [{ x: 32, y: 134 }, { x: 130, y: 143 }] },
  medium: { width: 364, height: 170, slots: [{ x: 48, y: 114 }, { x: 192, y: 140 }, { x: 235, y: 88 }, { x: 326, y: 141 }] },
  large: { width: 364, height: 382, slots: [{ x: 80, y: 205 }, { x: 213, y: 161 }, { x: 323, y: 223 }, { x: 170, y: 258 }, { x: 63, y: 283 }, { x: 187, y: 353 }, { x: 302, y: 337 }] },
} satisfies Record<VillageFamily, { width: number; height: number; slots: { x: number; y: number }[] }>;

/**
 * THE SEASONS THE VILLAGE CAN WEAR.
 *
 * `notebook` is the everyday garden. `blossom` is the orchard the onboarding
 * design uses, approved as six plates at exactly the notebook sizes, so a
 * scene can be swapped without touching a slot or a bound anywhere.
 *
 * Both are CLEAN PLATES -- grass, path and trees only. The caption, the cast
 * and the speech bubbles are drawn by the widget from live data, so a plate
 * with any of them baked in would render everything twice.
 */
export type VillageScenery = "notebook" | "blossom";

export const VILLAGE_BACKGROUNDS = {
  small: {
    light: require("../../assets/village/notebook-small-light.png"),
    dark: require("../../assets/village/notebook-small-dark.png"),
  },
  medium: {
    light: require("../../assets/village/notebook-medium-light.png"),
    dark: require("../../assets/village/notebook-medium-dark.png"),
  },
  large: {
    light: require("../../assets/village/notebook-large-light.png"),
    dark: require("../../assets/village/notebook-large-dark.png"),
  },
};

export const BLOSSOM_BACKGROUNDS = {
  small: {
    light: require("../../assets/village/blossom-small-light.png"),
    dark: require("../../assets/village/blossom-small-dark.png"),
  },
  medium: {
    light: require("../../assets/village/blossom-medium-light.png"),
    dark: require("../../assets/village/blossom-medium-dark.png"),
  },
  large: {
    light: require("../../assets/village/blossom-large-light.png"),
    dark: require("../../assets/village/blossom-large-dark.png"),
  },
};

/**
 * The plates for one scenery. Unknown names fall back to the everyday garden
 * rather than rendering nothing -- Benny asked for that fallback explicitly,
 * and a missing background is a blank widget, which is the worst outcome here.
 */
export function backgroundsFor(scenery: VillageScenery | null | undefined) {
  return scenery === "blossom" ? BLOSSOM_BACKGROUNDS : VILLAGE_BACKGROUNDS;
}
