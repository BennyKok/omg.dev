/**
 * Provider marks for hosted `omg/<provider>/<model>` rows.
 *
 * The same paths the web draws inline (web/src/lib/model-provider-icon-paths.ts:
 * Simple Icons, CC0, plus xAI and Z.ai marks from lobehub/lobe-icons, MIT),
 * rasterised black-on-transparent at 1x/2x/3x. React Native cannot render
 * SVG without a native module, and PNGs ride an over-the-air update. Draw
 * them with `tintColor` so the mark takes the row's text colour.
 */

import type { ImageSourcePropType } from "react-native";

const BY_PROVIDER: Record<string, ImageSourcePropType> = {
  callstack: require("../../assets/providers/provider-callstack.png"),
  anthropic: require("../../assets/providers/provider-anthropic.png"),
  deepseek: require("../../assets/providers/provider-deepseek.png"),
  minimax: require("../../assets/providers/provider-minimax.png"),
  openai: require("../../assets/providers/provider-openai.png"),
  qwen: require("../../assets/providers/provider-qwen.png"),
  xai: require("../../assets/providers/provider-xai.png"),
  zai: require("../../assets/providers/provider-zai.png"),
};

/** The mark for a provider slug from the id (`z-ai` -> `zai`), or null. */
export function modelProviderIcon(provider?: string | null): ImageSourcePropType | null {
  if (!provider) return null;
  const key = provider.toLowerCase().replace(/[^a-z0-9]/g, "");
  return BY_PROVIDER[key] ?? null;
}
