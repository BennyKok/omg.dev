/** Standing points on the notebook garden paths, measured in widget points. */
export type VillageFamily = "small" | "medium" | "large";
export const VILLAGE_SCENES = {
  small: { width: 170, height: 170, slots: [{ x: 139, y: 90 }, { x: 56, y: 119 }] },
  medium: { width: 364, height: 170, slots: [{ x: 126, y: 124 }, { x: 265, y: 111 }, { x: 324, y: 87 }, { x: 60, y: 151 }] },
  large: { width: 364, height: 382, slots: [{ x: 246, y: 180 }, { x: 169, y: 209 }, { x: 331, y: 153 }, { x: 265, y: 261 }, { x: 197, y: 299 }, { x: 119, y: 318 }, { x: 49, y: 351 }] },
} satisfies Record<VillageFamily, { width: number; height: number; slots: { x: number; y: number }[] }>;

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
