import { useMemo } from "react";
import { Image, StyleSheet, type ImageStyle, type StyleProp } from "react-native";

type SkiaModule = typeof import("@shopify/react-native-skia");
let skia: SkiaModule | undefined;
try {
  // Older installed binaries can lack Skia. Keep their existing image path.
  skia = require("@shopify/react-native-skia") as SkiaModule;
} catch {
  skia = undefined;
}

/**
 * Draw authenticated preview bytes without a recycled native Image view.
 * RCTImageComponentView accepts callbacks queued by its previous subscription,
 * even after recycling. A late avatar result can therefore replace a screenshot.
 * Decode the supplied data URI directly; there is no image request subscription
 * to outlive this tile. The full-screen viewer still uses its own Image view.
 */
export function ImagePreview({ uri, width, height, radius, placeholderColor, style, accessibilityLabel }: {
  uri: string;
  width: number;
  height: number;
  radius: number;
  placeholderColor: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel: string;
}) {
  const bitmap = useMemo(() => {
    if (!skia) return null;
    // RN FileReader can use application/octet-stream when Blob.type is empty.
    // The decoder identifies the image format from the bytes, not this label.
    const match = /^data:[^,]*;base64,(.+)$/s.exec(uri);
    if (!match) return null;
    try {
      return skia.Skia.Image.MakeImageFromEncoded(skia.Skia.Data.fromBase64(match[1]));
    } catch {
      return null;
    }
  }, [uri]);
  const frame: ImageStyle = { width, height, borderRadius: radius, backgroundColor: placeholderColor };
  if (!skia) {
    return <Image source={{ uri }} accessible accessibilityLabel={accessibilityLabel} resizeMode="cover" style={[frame, style]} />;
  }
  const { Canvas, Image: Bitmap } = skia;
  const fit = StyleSheet.flatten(style)?.resizeMode === "contain" ? "contain" : "cover";
  return <Canvas accessible accessibilityLabel={accessibilityLabel} style={[frame, style, { overflow: "hidden" }]}>
    {bitmap ? <Bitmap image={bitmap} x={0} y={0} width={width} height={height} fit={fit} /> : null}
  </Canvas>;
}
