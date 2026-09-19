/**
 * The working-state grid, drawn once per row by the GPU.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The view-tree implementation in session-activity.tsx builds, for ONE working
 * row at phone width: 320 dot views, 24 animated group views, and one more
 * animated view per sparkle (about 80). Every one of those animated views owns
 * a `useAnimatedStyle` worklet that re-runs on every frame, and since
 * 6d423487e each sparkle worklet also evaluates value noise -- three or four
 * hash rounds of two `Math.imul` each -- per frame.
 *
 * Those worklets already run on the UI thread, so this is NOT about moving
 * work off JavaScript. It is about the COUNT. The effect is a pure function of
 * position and time, which is exactly what a fragment shader is, so the whole
 * field collapses into one canvas, one draw call, and one uniform update per
 * frame regardless of how many dots it contains.
 *
 * ── It is a visual equivalent, not a port ─────────────────────────────────
 *
 * `noiseHash` in session-activity.tsx is an integer avalanche built on
 * `Math.imul`. SkSL has no dependable 32-bit integer multiply across the
 * drivers this ships to, so the shader uses the ordinary `fract(sin(...))`
 * hash instead. The geometry, the wave, the strength falloff and the sparkle
 * density all match the view path exactly. The particular dot that twinkles at
 * a particular second does not. Nothing in the product depends on which one
 * does, and the JavaScript functions remain the tested definition for the
 * fallback path.
 *
 * ── Availability ──────────────────────────────────────────────────────────
 *
 * Skia is a native dependency. A client built before it was added has no
 * native module, and `activityCanvasSupported` is false there, so the view
 * path keeps running. Do not remove that path.
 */
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

type SkiaModule = typeof import("@shopify/react-native-skia");

let skia: SkiaModule | undefined;
let effect: ReturnType<NonNullable<SkiaModule["Skia"]["RuntimeEffect"]["Make"]>> | null = null;

/**
 * A moving highlight, smooth per-dot breathing, and sparse sparkle accents.
 * Read it beside activityWave / activityBreath / activitySparkle: the same
 * three functions, in the same order.
 */
const SOURCE = `
uniform float2 uSize;
uniform float  uPhase;
uniform float  uVisibility;
uniform float  uRowSeed;
// 1 when Reduce Motion is on: a still field, and no sparkle layer at all.
uniform float  uReduced;
// x, y, width, height of the measured text column. width <= 0 means none.
uniform float4 uText;
uniform float4 uBase;
uniform float4 uSpark;

const float SPACING = 10.0;
const float ORIGIN  = 5.0;
const float RADIUS  = 3.5;
const float CORNER  = 2.0;
const float GROUPS  = 24.0;

float hash1(float n) {
  return fract(sin(n * 12.9898 + uRowSeed * 0.0001) * 43758.5453123);
}

float hash2(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7)) + uRowSeed * 0.0001) * 43758.5453123);
}

// activityWave: a 0.6-wide cosine bump sweeping from before the left edge to
// past the right one, clearing both before the clock wraps.
float wave(float position) {
  float head = fract(uPhase) * 1.6 - 0.3;
  float distance = abs(position - head);
  return distance >= 0.3 ? 0.0 : (1.0 + cos(distance / 0.3 * 3.14159265) * 1.0) * 0.5;
}

// activityBreath: value noise in time, new target every 4.4s, squared so the
// field sits dark and the peaks are occasional.
float breath(float seed, float salt) {
  float time = uPhase * 0.5 + seed * 2048.0;
  float cell = floor(time);
  float f = time - cell;
  float blend = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float from = hash1(cell + salt * 1000.0);
  float to   = hash1(cell + 1.0 + salt * 1000.0);
  float noise = from + (to - from) * blend;
  return 0.04 + 0.96 * noise * noise;
}

// half is a reserved type name in SkSL and cannot be a parameter name.
float roundedBox(float2 p, float halfSize, float corner) {
  float2 q = abs(p) - float2(halfSize, halfSize) + float2(corner, corner);
  return min(max(q.x, q.y), 0.0) + length(max(q, float2(0.0, 0.0))) - corner;
}

half4 main(float2 xy) {
  // Only the nearest grid cell can cover this pixel: the dot is 7 wide and the
  // cells are 10 apart, so neighbours cannot overlap.
  float2 index = floor((xy - ORIGIN) / SPACING + 0.5);
  float2 center = index * SPACING + ORIGIN;
  if (center.x < ORIGIN || center.y < ORIGIN ||
      center.x >= uSize.x || center.y >= uSize.y) {
    return half4(0.0);
  }

  float coverage = 1.0 - smoothstep(-0.5, 0.5, roundedBox(xy - center, RADIUS, CORNER));
  if (coverage <= 0.0) return half4(0.0);

  float x = center.x;
  float y = center.y;

  float edge = min(1.0, min(x / 70.0, (uSize.x - x) / 70.0));
  float bottom = clamp((uSize.y - y) / 24.0, 0.0, 1.0);
  float bottomFade = bottom * bottom * (3.0 - 2.0 * bottom);
  float lower = pow(y / uSize.y, 3.0);

  float textDim = 1.0;
  if (uText.z > 0.0) {
    float dx = max(max(uText.x - x, 0.0), x - uText.x - uText.z);
    float dy = max(max(uText.y - y, 0.0), y - uText.y - uText.w);
    textDim = 0.12 + 0.88 * min(1.0, length(float2(dx, dy)) / 16.0);
  }

  float strength = edge * bottomFade * lower * textDim;
  if (strength <= 0.0) return half4(0.0);

  float position = floor(x / uSize.x * (GROUPS - 1.0) + 0.5) / (GROUPS - 1.0);
  float seed = hash2(index);

  float lit = uReduced > 0.5 ? 0.27 : (0.045 + wave(position) * 0.6);
  float baseAlpha = strength * uVisibility * lit * coverage;

  // One dot in four twinkles. The same dot every time, because the choice is a
  // hash of its own cell and not of the clock.
  float sparkAlpha = 0.0;
  if (uReduced <= 0.5 && hash1(seed * 313.7) < 0.25) {
    float b = breath(seed, hash1(seed * 97.3));
    float sparkle = b * 0.5 + b * wave(position) * 0.5;
    sparkAlpha = strength * uVisibility * sparkle * 0.9 * coverage;
  }

  // Source-over, matching the two stacked layers the view path draws.
  float outA = sparkAlpha + baseAlpha * (1.0 - sparkAlpha);
  if (outA <= 0.0) return half4(0.0);
  float3 outRGB = (uSpark.rgb * sparkAlpha + uBase.rgb * baseAlpha * (1.0 - sparkAlpha)) / outA;
  // Skia expects premultiplied alpha out of a runtime shader.
  return half4(half3(outRGB * outA), half(outA));
}
`;

try {
  // Not a static import: a client built before Skia was a dependency has no
  // native module, and the import itself is what throws there.
  skia = require("@shopify/react-native-skia") as SkiaModule;
  effect = skia.Skia.RuntimeEffect.Make(SOURCE);
  if (!effect) throw new Error("Session activity shader did not compile");
} catch (error) {
  // Worth a line: a shader that fails to compile falls back to a renderer
  // that looks almost identical, so the failure is otherwise invisible. That
  // happened on the first build here -- `half` is a reserved SkSL type and was
  // used as a parameter name, and the only symptom was the old renderer.
  console.warn("session activity: Skia unavailable, using the view path", String(error));
  skia = undefined;
  effect = null;
}

/**
 * A kill switch, and the benchmark's A/B handle.
 *
 * EXPO_PUBLIC_OMG_ACTIVITY_RENDERER=views forces the view path on a build that
 * has Skia. It is what lets bench/session-activity-entry.tsx measure the two
 * renderers against each other in the same binary, and it is the lever to pull
 * if the shader misbehaves on a device class we have not seen.
 */
const forcedViews = process.env.EXPO_PUBLIC_OMG_ACTIVITY_RENDERER === "views";

/** False on web, on older clients, and if the shader fails to compile. */
export const activityCanvasSupported = !!skia && !!effect && !forcedViews;

export type ActivityCanvasProps = {
  width: number;
  height: number;
  cornerRadius: number;
  phase: SharedValue<number>;
  visibility: SharedValue<number>;
  rowSeed: number;
  reducedMotion: boolean;
  /** Already offset into field coordinates by the caller. */
  text?: { x: number; y: number; width: number; height: number };
  baseColor: string;
  sparkColor: string;
};

/**
 * Assumes `activityCanvasSupported`. The caller checks it once; checking again
 * in here would make the hook below conditional.
 */
export function ActivityCanvas(props: ActivityCanvasProps) {
  const { Canvas, Fill, Group, Shader, Skia, rect, rrect } = skia!;
  const base = Skia.Color(props.baseColor);
  const spark = Skia.Color(props.sparkColor);
  const text = props.text && props.text.width > 0
    ? [props.text.x, props.text.y, props.text.width, props.text.height]
    : [0, 0, 0, 0];
  // One uniform write per frame for the whole field, on the UI thread.
  const uniforms = useDerivedValue(() => ({
    uSize: [props.width, props.height],
    uPhase: props.phase.value,
    uVisibility: props.visibility.value,
    uRowSeed: props.rowSeed,
    uReduced: props.reducedMotion ? 1 : 0,
    uText: text,
    uBase: [base[0], base[1], base[2], base[3]],
    uSpark: [spark[0], spark[1], spark[2], spark[3]],
  }));
  return (
    <Canvas style={{ width: props.width, height: props.height }}>
      <Group clip={rrect(rect(0, 0, props.width, props.height), props.cornerRadius, props.cornerRadius)}>
        <Fill>
          <Shader source={effect!} uniforms={uniforms} />
        </Fill>
      </Group>
    </Canvas>
  );
}
