/** Roaming centres across the grass, measured in widget points. */
export type VillageFamily = "small" | "medium" | "large";
export const VILLAGE_SCENES = {
  small: { width: 170, height: 170, slots: [{ x: 32, y: 134 }, { x: 130, y: 143 }] },
  medium: { width: 364, height: 170, slots: [{ x: 48, y: 114 }, { x: 192, y: 140 }, { x: 235, y: 88 }, { x: 326, y: 141 }] },
  large: { width: 364, height: 382, slots: [{ x: 80, y: 205 }, { x: 213, y: 161 }, { x: 323, y: 223 }, { x: 170, y: 258 }, { x: 63, y: 283 }, { x: 187, y: 353 }, { x: 302, y: 337 }] },
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
