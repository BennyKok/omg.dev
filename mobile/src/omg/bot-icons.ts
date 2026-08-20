/**
 * The real bot mascot, rasterised.
 *
 * Same trade agent-icons.ts made for the nine coding-agent marks: React
 * Native cannot render SVG without react-native-svg, and that is a native
 * module — adding it would cost a TestFlight build for what is otherwise an
 * asset change. So the mascot's 5-shape x 5-colorway matrix ships as PNGs,
 * rasterised pixel-for-pixel from web/src/components/BotAvatar.tsx's own
 * geometry by scripts/generate-bot-avatars.ts (see that script's header for
 * exactly what "idle" frame it captures and what it deliberately drops —
 * the breathing wobble, the shape-morph tween, the three non-idle motion
 * states). PNGs ride along with an OTA update instead of a new build.
 *
 * bot-avatar.tsx composites this mark onto a neutral rounded-square plate,
 * the same disc-plus-mark split AgentAvatar already uses (components.tsx) —
 * see that file for why the plate stays neutral rather than tinted.
 */

import type { ImageSourcePropType } from "react-native";
import type { BotColorway, BotShape } from "./bots";

const BY_SHAPE: Record<BotShape, Record<BotColorway, ImageSourcePropType>> = {
  circle: {
    warm: require("../../assets/bots/bot-circle-warm.png"),
    brand: require("../../assets/bots/bot-circle-brand.png"),
    violet: require("../../assets/bots/bot-circle-violet.png"),
    forest: require("../../assets/bots/bot-circle-forest.png"),
    midnight: require("../../assets/bots/bot-circle-midnight.png"),
  },
  squircle: {
    warm: require("../../assets/bots/bot-squircle-warm.png"),
    brand: require("../../assets/bots/bot-squircle-brand.png"),
    violet: require("../../assets/bots/bot-squircle-violet.png"),
    forest: require("../../assets/bots/bot-squircle-forest.png"),
    midnight: require("../../assets/bots/bot-squircle-midnight.png"),
  },
  teardrop: {
    warm: require("../../assets/bots/bot-teardrop-warm.png"),
    brand: require("../../assets/bots/bot-teardrop-brand.png"),
    violet: require("../../assets/bots/bot-teardrop-violet.png"),
    forest: require("../../assets/bots/bot-teardrop-forest.png"),
    midnight: require("../../assets/bots/bot-teardrop-midnight.png"),
  },
  pebble: {
    warm: require("../../assets/bots/bot-pebble-warm.png"),
    brand: require("../../assets/bots/bot-pebble-brand.png"),
    violet: require("../../assets/bots/bot-pebble-violet.png"),
    forest: require("../../assets/bots/bot-pebble-forest.png"),
    midnight: require("../../assets/bots/bot-pebble-midnight.png"),
  },
  hexagon: {
    warm: require("../../assets/bots/bot-hexagon-warm.png"),
    brand: require("../../assets/bots/bot-hexagon-brand.png"),
    violet: require("../../assets/bots/bot-hexagon-violet.png"),
    forest: require("../../assets/bots/bot-hexagon-forest.png"),
    midnight: require("../../assets/bots/bot-hexagon-midnight.png"),
  },
};

/** Same defaults the web falls back to for a bot with no shape/colorway chosen yet. */
const DEFAULT_SHAPE: BotShape = "circle";
const DEFAULT_COLORWAY: BotColorway = "warm";

export function botIcon(shape?: BotShape | null, colorway?: BotColorway | null): ImageSourcePropType {
  const shapeRow = BY_SHAPE[shape ?? DEFAULT_SHAPE] ?? BY_SHAPE[DEFAULT_SHAPE];
  return shapeRow[colorway ?? DEFAULT_COLORWAY] ?? shapeRow[DEFAULT_COLORWAY];
}
