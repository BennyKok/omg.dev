// Drawing helpers for a 2D world with React Native views. Game state is in
// world units; `World` converts to screen pixels using the camera, so a
// sprite only needs its world position. Views plus react-native-svg run
// identically on web, iOS and Android (Expo Go included), with no extra
// native module. Fine for a few hundred moving shapes.
//
//   const { width, height, onLayout } = useViewSize();
//   <View style={{ flex: 1 }} onLayout={onLayout}>
//     <World cam={cam} width={width} height={height} background="#2b3a55">
//       <Sprite x={p.x} y={p.y} size={40} angle={p.angle} color="#ff5a6a" shape="circle" />
//     </World>
//   </View>
//
// Do not size by useWindowDimensions(): in a static web export it is 0 until
// the first resize. Measure the container with onLayout (useViewSize).
import { useCallback, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import type { Camera } from "../game/camera";

export function useViewSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
  }, []);
  return { ...size, onLayout };
}

export function World({ cam, width, height, background, children, worldSize }: {
  cam: Camera; width: number; height: number; background?: string; children?: React.ReactNode;
  /** Draws the world edge as a darker frame when given. */
  worldSize?: { w: number; h: number };
}) {
  // One translated, scaled layer: children use world coordinates directly.
  const tx = width / 2 - cam.x * cam.zoom;
  const ty = height / 2 - cam.y * cam.zoom;
  return (
    <View style={[styles.viewport, { width, height, backgroundColor: background ?? "#2b3a55" }]}>
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: worldSize?.w ?? 1,
          height: worldSize?.h ?? 1,
          transform: [{ translateX: tx }, { translateY: ty }, { scale: cam.zoom }],
          transformOrigin: "0 0",
        }}
      >
        {worldSize ? <View style={[StyleSheet.absoluteFill, styles.worldFrame]} /> : null}
        {children}
      </View>
    </View>
  );
}

export type SpriteShape = "circle" | "rect";

/** A coloured shape centred on (x, y) in world units. `angle` is in radians. */
export function Sprite({ x, y, size, w, h, angle = 0, color, shape = "rect", label, opacity = 1, borderColor }: {
  x: number; y: number; size?: number; w?: number; h?: number; angle?: number; color: string; shape?: SpriteShape;
  label?: string; opacity?: number; borderColor?: string;
}) {
  const sw = w ?? size ?? 20;
  const sh = h ?? size ?? 20;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x - sw / 2,
        top: y - sh / 2,
        width: sw,
        height: sh,
        borderRadius: shape === "circle" ? Math.max(sw, sh) / 2 : 4,
        backgroundColor: color,
        opacity,
        borderWidth: borderColor ? 2 : 0,
        borderColor,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ rotate: `${angle}rad` }],
      }}
    >
      {label ? <Text style={{ fontSize: Math.min(sw, sh) * 0.6 }}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { overflow: "hidden" },
  worldFrame: { borderWidth: 3, borderColor: "rgba(255,255,255,0.25)", backgroundColor: "rgba(255,255,255,0.05)" },
});
