// Drawing helpers for a 2D world with React Native views. Game state is in
// world units; `World` converts to screen pixels using the camera, so a
// sprite only needs its world position. Views plus react-native-svg run
// identically on web, iOS and Android (Expo Go included).
//
//   const { width, height, onLayout } = useViewSize();
//   <View style={{ flex: 1 }} onLayout={onLayout}>
//     <World cam={cam} width={width} height={height} background="#2b3a55">
//       <Sprite of={player} size={40} color="#ff5a6a" shape="circle" />
//       <Live of={enemy}><EnemyArt /></Live>
//     </World>
//   </View>
//
// Anything that moves: pass the game object itself as `of` (it needs `x`, `y`
// and optional `angle`). Its view then follows the object on every frame with
// no React render (see game/live.ts). `x`/`y` props still work for objects that
// never move; they only update when React redraws (`renderHz`, default 30).
//
// Do not size by useWindowDimensions(): in a static web export it is 0 until
// the first resize. Measure the container with onLayout (useViewSize).
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, Platform, StyleSheet, Text, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import type { Camera } from "../game/camera";
import { addLive } from "../game/live";

/** Anything with a world position. Game objects already have this shape. */
export type Placed = { x: number; y: number; angle?: number };

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
  // The camera is live: the layer follows `cam` on every frame.
  const view = useRef({ cam, width, height });
  view.current = { cam, width, height };
  const live = useLiveTransform(() => {
    const v = view.current;
    return [v.width / 2 - v.cam.x * v.cam.zoom, v.height / 2 - v.cam.y * v.cam.zoom, 0, v.cam.zoom];
  });
  return (
    <View style={[styles.viewport, { width, height, backgroundColor: background ?? "#2b3a55" }]}>
      <Animated.View ref={live.ref} style={[styles.layer, { width: worldSize?.w ?? 1, height: worldSize?.h ?? 1 }, live.style]}>
        {worldSize ? <View style={[StyleSheet.absoluteFill, styles.worldFrame]} /> : null}
        {children}
      </Animated.View>
    </View>
  );
}

// A live transform is [translateX, translateY, rotate (radians), scale]. The
// kit loop calls `read` once per frame and writes only when a number changed.
type LiveTransform = { ref: (node: unknown) => void; style: object };
type Read = () => number[];

function useWatch(read: Read, write: (t: number[]) => void) {
  const readRef = useRef(read);
  readRef.current = read;
  const writeRef = useRef(write);
  writeRef.current = write;
  useEffect(() => {
    let last: number[] = []; // the first sync always writes
    return addLive(() => {
      const next = readRef.current();
      for (let i = 0; i < 4; i++) {
        if (next[i] !== last[i]) {
          last = next;
          writeRef.current(next);
          return;
        }
      }
    });
  }, []);
}

const cssTransform = (t: number[]) => `translate(${t[0]}px, ${t[1]}px) rotate(${t[2]}rad) scale(${t[3]})`;

// Web: write the CSS transform on the element itself. React's redraws set the
// same value from the latest render, so the two never disagree.
function useLiveTransformWeb(read: Read): LiveTransform {
  const node = useRef<HTMLElement | null>(null);
  useWatch(read, (t) => {
    if (node.current) node.current.style.transform = cssTransform(t);
  });
  const ref = useCallback((n: unknown) => {
    node.current = n as HTMLElement | null;
  }, []);
  const t = read();
  return { ref, style: { transform: [{ translateX: t[0] }, { translateY: t[1] }, { rotate: `${t[2]}rad` }, { scale: t[3] }] } };
}

// iOS and Android: a Reanimated shared value moves the view on the UI thread.
function useLiveTransformNative(read: Read): LiveTransform {
  const value = useSharedValue(read());
  useWatch(read, (t) => {
    value.value = t;
  });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: value.value[0] }, { translateY: value.value[1] }, { rotate: `${value.value[2]}rad` }, { scale: value.value[3] }],
  }));
  return { ref: noRef, style };
}
const noRef = () => {};

const useLiveTransform = Platform.OS === "web" ? useLiveTransformWeb : useLiveTransformNative;

/**
 * Places its children at `of.x`, `of.y` (world units), rotated by `of.angle`
 * radians, and follows the object on every frame without a React render.
 * Children are drawn in a `w` x `h` box centred on the object. Use it for your
 * own art (SVG, emoji, images); use `Sprite` for plain shapes.
 */
export const Live = memo(function Live({ of, w = 0, h = 0, style, children }: {
  of: Placed; w?: number; h?: number; style?: ViewStyle; children?: React.ReactNode;
}) {
  const ofRef = useRef(of);
  ofRef.current = of;
  const live = useLiveTransform(() => [ofRef.current.x - w / 2, ofRef.current.y - h / 2, ofRef.current.angle ?? 0, 1]);
  return (
    <Animated.View ref={live.ref} pointerEvents="none" style={[styles.live, { width: w, height: h }, style, live.style]}>
      {children}
    </Animated.View>
  );
});

export type SpriteShape = "circle" | "rect";

/**
 * A coloured shape centred on its object. Pass the moving game object as `of`
 * so it follows every frame. `x`, `y` and `angle` props are for still shapes.
 */
export const Sprite = memo(function Sprite({ of, x = 0, y = 0, size, w, h, angle = 0, color, shape = "rect", label, opacity = 1, borderColor }: {
  of?: Placed; x?: number; y?: number; size?: number; w?: number; h?: number; angle?: number; color: string; shape?: SpriteShape;
  label?: string; opacity?: number; borderColor?: string;
}) {
  const sw = w ?? size ?? 20;
  const sh = h ?? size ?? 20;
  const look: ViewStyle = {
    borderRadius: shape === "circle" ? Math.max(sw, sh) / 2 : 4,
    backgroundColor: color,
    opacity,
    borderWidth: borderColor ? 2 : 0,
    borderColor,
    alignItems: "center",
    justifyContent: "center",
  };
  const text = label ? <Text style={{ fontSize: Math.min(sw, sh) * 0.6 }}>{label}</Text> : null;
  if (of) {
    return (
      <Live of={of} w={sw} h={sh} style={look}>
        {text}
      </Live>
    );
  }
  return (
    <View
      pointerEvents="none"
      style={[look, { position: "absolute", left: x - sw / 2, top: y - sh / 2, width: sw, height: sh, transform: [{ rotate: `${angle}rad` }] }]}
    >
      {text}
    </View>
  );
});

const styles = StyleSheet.create({
  viewport: { overflow: "hidden" },
  layer: { position: "absolute", left: 0, top: 0, transformOrigin: "0 0" },
  live: { position: "absolute", left: 0, top: 0 },
  worldFrame: { borderWidth: 3, borderColor: "rgba(255,255,255,0.25)", backgroundColor: "rgba(255,255,255,0.05)" },
});
