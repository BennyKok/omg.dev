import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Reanimated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

/**
 * Boxy, the omg.dev mascot: a hand-drawn ink computer with an amber pixel
 * face. Same drawing as the web splash (web/index.html) and the web
 * connection overlay (web/src/components/boxy.tsx). Only the face changes
 * with the mood.
 *
 * Layers, back to front, in the drawing's own 200 x 200 units:
 * 1. the dark screen and the amber pixels, as Views driven by Reanimated
 *    (the parts that move);
 * 2. the ink body and the screen grid, drawn by Skia on top (static).
 *
 * Skia is required lazily, like session-activity-canvas.tsx: a client built
 * before Skia was a dependency has no native module, and the import itself
 * throws there. Without it the ink falls back to plain bordered Views.
 */
export type BoxyMood = "booting" | "searching" | "sleeping" | "error" | "happy";

type SkiaModule = typeof import("@shopify/react-native-skia");
let skia: SkiaModule | undefined;
try {
  skia = require("@shopify/react-native-skia") as SkiaModule;
} catch {
  skia = undefined;
}

const AMBER = "#ffb547";
const SCREEN = "#1d1209";
const INK_PATHS = [
  "M52 22C92 19 130 20 150 23C160 25 163 32 163 44L164 150C164 160 158 165 147 165L54 166C43 166 38 160 38 149L37 40C37 29 42 23 52 22Z",
  "M58 42C85 40 120 40 143 42L144 104C120 106 84 106 57 105Z",
  "M110 130L146 129M118 140L146 140M58 136C60 133 66 133 68 136M60 166L56 178M142 166L146 178M48 178L66 178M136 178L154 178",
];

// The screen is a 13 x 8 grid of 6.4-unit cells starting at (60, 51.6).
const FACES = {
  idle: [".............", "..##.....##..", "..##.....##..", "..##.....##..", ".............", ".....###....."],
  happy: [".............", "..#.#...#.#..", ".#...#.#...#.", ".............", "....#...#....", ".....###....."],
  blink: [".............", ".............", ".............", "..##.....##..", ".............", ".....###....."],
  sleep: [".............", ".............", ".............", "..##.....##..", ".............", "......#......"],
  error: [".............", "..#.#...#.#..", "...#.....#...", "..#.#...#.#..", ".............", ".....###....."],
} as const;

function cells(rows: readonly string[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") out.push([x, y]);
  });
  return out;
}

function Face({ rows, unit }: { rows: readonly string[]; unit: number }) {
  return (
    <>
      {cells(rows).map(([x, y]) => (
        <View
          key={`${x}-${y}`}
          style={{
            position: "absolute",
            left: (60 + x * 6.4) * unit,
            top: (51.6 + y * 6.4) * unit,
            width: 5.2 * unit,
            height: 5.2 * unit,
            borderRadius: unit,
            backgroundColor: AMBER,
          }}
        />
      ))}
    </>
  );
}

function SkiaInk({ size, color }: { size: number; color: string }) {
  const S = skia!;
  const paths = useMemo(() => INK_PATHS.map((d) => S.Skia.Path.MakeFromSVGString(d)), [S]);
  const grid = useMemo(() => {
    const rects: Array<{ x: number; y: number }> = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 13; c++) rects.push({ x: 60 + c * 6.4, y: 51.6 + r * 6.4 });
    return rects;
  }, []);
  const { Canvas, Group, Path, RoundedRect } = S;
  return (
    <Canvas style={{ position: "absolute", left: 0, top: 0, width: size, height: size }} pointerEvents="none">
      <Group transform={[{ scale: size / 200 }]}>
        {grid.map(({ x, y }) => (
          <RoundedRect key={`${x}-${y}`} x={x} y={y} width={5.2} height={5.2} r={1} color={AMBER} opacity={0.13} />
        ))}
        {paths.map((path, i) =>
          path ? (
            <Path
              key={i}
              path={path}
              style="stroke"
              strokeWidth={3.2}
              strokeCap="round"
              strokeJoin="round"
              color={color}
            />
          ) : null,
        )}
      </Group>
    </Canvas>
  );
}

/** Straight-line stand-in for a client without Skia. Same proportions. */
function ViewInk({ size, color }: { size: number; color: string }) {
  const u = size / 200;
  const line = Math.max(1.5, 3.2 * u);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={{
          position: "absolute",
          left: 37.5 * u,
          top: 22 * u,
          width: 126 * u,
          height: 144 * u,
          borderWidth: line,
          borderColor: color,
          borderRadius: 13 * u,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 57 * u,
          top: 41 * u,
          width: 87 * u,
          height: 64 * u,
          borderWidth: line,
          borderColor: color,
          borderRadius: 4 * u,
        }}
      />
      <View style={{ position: "absolute", left: 110 * u, top: 129 * u, width: 36 * u, height: line, backgroundColor: color }} />
      <View style={{ position: "absolute", left: 118 * u, top: 139 * u, width: 28 * u, height: line, backgroundColor: color }} />
      <View style={{ position: "absolute", left: 48 * u, top: 177 * u, width: 18 * u, height: line, backgroundColor: color }} />
      <View style={{ position: "absolute", left: 136 * u, top: 177 * u, width: 18 * u, height: line, backgroundColor: color }} />
      <View style={{ position: "absolute", left: 57 * u, top: 166 * u, width: line, height: 12 * u, backgroundColor: color }} />
      <View style={{ position: "absolute", left: 143 * u, top: 166 * u, width: line, height: 12 * u, backgroundColor: color }} />
    </View>
  );
}

export function Boxy({
  mood,
  size = 96,
  color,
  testID,
}: {
  mood: BoxyMood;
  size?: number;
  /** Ink colour. Pass the theme's foreground. */
  color: string;
  testID?: string;
}) {
  const u = size / 200;
  const reduced = useReducedMotion();

  const blink = useSharedValue(0);
  const look = useSharedValue(0);
  const crt = useSharedValue(reduced || mood !== "booting" ? 1 : 0);
  const cover = useSharedValue(reduced || mood !== "booting" ? 0 : 1);
  const z = useSharedValue(0);
  const shake = useSharedValue(0);
  const hop = useSharedValue(0);

  useEffect(() => {
    const all = [blink, look, crt, cover, z, shake, hop];
    all.forEach((v) => cancelAnimation(v));
    blink.value = 0;
    look.value = 0;
    z.value = 0;
    shake.value = 0;
    hop.value = 0;
    crt.value = 1;
    cover.value = 0;
    if (reduced) return;

    if (mood === "booting") {
      crt.value = 0;
      cover.value = 1;
      crt.value = withDelay(50, withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
      cover.value = withDelay(350, withTiming(0, { duration: 360, easing: Easing.linear }));
    }
    if (mood === "booting" || mood === "searching") {
      blink.value = withDelay(
        1000,
        withRepeat(
          withSequence(
            withTiming(0, { duration: 2950 }),
            withTiming(1, { duration: 0 }),
            withTiming(1, { duration: 160 }),
            withTiming(0, { duration: 0 }),
          ),
          -1,
        ),
      );
    }
    if (mood === "searching") {
      const d = 6.4 * u;
      look.value = withRepeat(
        withSequence(
          withTiming(-d, { duration: 380, easing: Easing.inOut(Easing.quad) }),
          withDelay(450, withTiming(d, { duration: 700, easing: Easing.inOut(Easing.quad) })),
          withDelay(450, withTiming(0, { duration: 380, easing: Easing.inOut(Easing.quad) })),
        ),
        -1,
      );
    }
    if (mood === "sleeping") {
      z.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.quad) }), -1);
    }
    if (mood === "error") {
      shake.value = withSequence(
        withTiming(-4 * u, { duration: 80 }),
        withTiming(4 * u, { duration: 110 }),
        withTiming(-2 * u, { duration: 110 }),
        withTiming(0, { duration: 80 }),
      );
    }
    if (mood === "happy") {
      hop.value = withSequence(
        withTiming(-0.08 * size, { duration: 200, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 300, easing: Easing.bounce }),
      );
    }
  }, [mood, reduced, u, size, blink, look, crt, cover, z, shake, hop]);

  const bodyStyle = useAnimatedStyle(() => ({ transform: [{ translateY: hop.value }] }));
  const faceStyle = useAnimatedStyle(() => ({ transform: [{ translateX: look.value + shake.value }] }));
  const openStyle = useAnimatedStyle(() => ({ opacity: 1 - blink.value }));
  const shutStyle = useAnimatedStyle(() => ({ opacity: blink.value }));
  const coverStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: cover.value }], opacity: cover.value > 0.001 ? 1 : 0 }));
  const crtStyle = useAnimatedStyle(() => ({
    opacity: crt.value < 1 ? 1 - crt.value * 0.6 : 0,
    transform: [{ scaleX: 0.9 + crt.value * 0.1 }, { scaleY: 0.04 + crt.value * 0.96 }],
  }));
  const zStyle = useAnimatedStyle(() => ({
    opacity: z.value < 0.3 ? z.value / 0.3 : z.value < 0.7 ? 1 - (z.value - 0.3) / 0.4 : 0,
    transform: [{ translateX: z.value * 8 * u }, { translateY: (4 - z.value * 20) * u }],
  }));

  const screen = { position: "absolute" as const, left: 58 * u, top: 42 * u, width: 86 * u, height: 63 * u, borderRadius: 6 * u };
  const showOpen = mood === "booting" || mood === "searching";

  return (
    <Reanimated.View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width: size, height: size }, bodyStyle]}
    >
      <View style={[screen, { backgroundColor: SCREEN }]} />
      <Reanimated.View style={[StyleSheet.absoluteFill, faceStyle]}>
        {showOpen ? (
          <>
            <Reanimated.View style={[StyleSheet.absoluteFill, openStyle]}>
              <Face rows={FACES.idle} unit={u} />
            </Reanimated.View>
            <Reanimated.View style={[StyleSheet.absoluteFill, shutStyle]}>
              <Face rows={FACES.blink} unit={u} />
            </Reanimated.View>
          </>
        ) : null}
        {mood === "happy" ? <Face rows={FACES.happy} unit={u} /> : null}
        {mood === "sleeping" ? <Face rows={FACES.sleep} unit={u} /> : null}
        {mood === "error" ? <Face rows={FACES.error} unit={u} /> : null}
      </Reanimated.View>
      {mood === "booting" && !reduced ? (
        <>
          <Reanimated.View style={[screen, { backgroundColor: SCREEN, transformOrigin: "bottom" }, coverStyle]} />
          <Reanimated.View style={[screen, { backgroundColor: AMBER }, crtStyle]} />
        </>
      ) : null}
      {/* Keyed by size: a canvas reused at a new size (the 28pt pill growing
          into the 80pt card) kept its old drawing, a single corner of ink,
          until something else re-rendered it. */}
      {skia ? <SkiaInk key={size} size={size} color={color} /> : <ViewInk size={size} color={color} />}
      {mood === "sleeping" ? (
        <Reanimated.View
          style={[
            { position: "absolute", left: 170 * u, top: 26 * u, width: 10 * u, height: 10 * u },
            reduced ? { opacity: 1 } : zStyle,
          ]}
        >
          <View style={{ position: "absolute", left: 0, top: 0, width: 10 * u, height: 3 * u, backgroundColor: AMBER }} />
          <View
            style={{
              position: "absolute",
              left: 0,
              top: 3.5 * u,
              width: 14 * u,
              height: 3 * u,
              backgroundColor: AMBER,
              transform: [{ rotate: "-45deg" }],
            }}
          />
          <View style={{ position: "absolute", left: 0, top: 7 * u, width: 10 * u, height: 3 * u, backgroundColor: AMBER }} />
        </Reanimated.View>
      ) : null}
    </Reanimated.View>
  );
}
