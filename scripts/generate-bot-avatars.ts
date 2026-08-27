import { resolve } from "node:path";
import sharp from "sharp";

/**
 * Rasterises the omg.dev bot mascot for the native iOS client.
 *
 * Same trade as scripts/generate-icons.ts made for the nine coding-agent
 * marks (see mobile/src/omg/agent-icons.ts): React Native cannot render SVG
 * without react-native-svg, and that is a native module the app has
 * deliberately stayed off (an OTA update carries a PNG; it does not carry a
 * new native module). So the mascot ships as PNGs instead of the animated
 * SVG web draws.
 *
 * PIXEL-FOR-PIXEL, NOT REDRAWN. The geometry below — ANGLES, the five
 * SHAPES radius tables, radiiToPoints, smoothPath, pathFor — is copied
 * verbatim from web/src/components/BotAvatar.tsx's pure math (no DOM, no
 * React, so it lifts out unchanged). Each combination is rendered as the
 * exact static SVG that component's own JSX produces for `state="idle"`:
 * idle's radii multiplier is 1 (STATES.idle.radii === circle, all entries
 * R), so the idle silhouette IS the shape's raw rest geometry, and idle's
 * pupil sits at the untransformed translate(16,-12)/scaleY(1) the component
 * renders before any rAF tick ever runs. That static frame is the honest
 * "what does this creature look like," which is what a non-animated PNG
 * should be.
 *
 * WHAT IS DELIBERATELY NOT PORTED: the breathing wobble, the shape-morph
 * tween, the blink, the four motion states (thinking/working/sleeping) and
 * their pupil positions. Those need a live rAF loop; a PNG is one frame.
 * mobile/src/omg/bot-avatar.tsx recovers a cheap approximation of "working"
 * with a pulsing dot overlay instead, the same trick AgentAvatar already
 * uses for busy coding agents.
 */

const root = resolve(import.meta.dir, "..");
const outDir = resolve(root, "mobile/assets/bots");

/* ---------------- geometry, copied verbatim from web/src/components/BotAvatar.tsx ---------------- */

const N = 12;
const ANGLES = Array.from({ length: N }, (_, i) => -90 + i * (360 / N));
const R = 70;
const deg2rad = (d: number) => (d * Math.PI) / 180;
const angDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

const circle = ANGLES.map(() => R);

const squircle = ANGLES.map((a) => {
  const t = deg2rad(a);
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  return R / Math.pow(Math.pow(c, 4) + Math.pow(s, 4), 0.25);
});

const teardrop = (() => {
  const SPIKE = 240;
  const BUMP = 0.36;
  const DENT = 0.16;
  return ANGLES.map((a) => {
    const d = angDiff(a, SPIKE);
    const bump = BUMP * Math.exp(-(d * d) / (2 * 18 * 18));
    const od = angDiff(a, SPIKE + 180);
    const dent = DENT * Math.exp(-(od * od) / (2 * 40 * 40));
    return R * (1 + bump - dent);
  });
})();

const pebble = [0.92, 0.95, 1.2, 1.06, 0.84, 0.8, 0.9, 1.14, 1.24, 0.98, 0.86, 0.88].map(
  (f) => R * f,
);

const hexagon = (() => {
  const period = Math.PI / 3;
  return ANGLES.map((a) => {
    const t = deg2rad(a);
    const m = ((t % period) + period) % period;
    const raw = Math.cos(Math.PI / 6) / Math.cos(m - Math.PI / 6);
    const norm = (raw - 0.866) / (1 - 0.866);
    return R * (0.9 + 0.14 * norm);
  });
})();

const SHAPES: Record<string, number[]> = { circle, squircle, teardrop, pebble, hexagon };
const BOT_SHAPES = ["circle", "squircle", "teardrop", "pebble", "hexagon"] as const;

function radiiToPoints(radii: number[], cx: number, cy: number): [number, number][] {
  return radii.map((r, i) => {
    const a = deg2rad(ANGLES[i]);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
  });
}

function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  const TENSION = 8;
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)} `;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / TENSION;
    const c1y = p1[1] + (p2[1] - p0[1]) / TENSION;
    const c2x = p2[0] - (p3[0] - p1[0]) / TENSION;
    const c2y = p2[1] - (p3[1] - p1[1]) / TENSION;
    d += `C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)} `;
  }
  return `${d}Z`;
}

const pathFor = (radii: number[]) => smoothPath(radiiToPoints(radii, 100, 100));

/* ---------------- colorways, copied verbatim from web/src/components/BotAvatar.tsx ---------------- */

const COLORWAYS: Record<string, { stops: [string, string]; eye: string }> = {
  warm: { stops: ["#f0a04b", "#b4451f"], eye: "#fff5e8" },
  brand: { stops: ["#4d7cff", "#06b6d4"], eye: "#f0f8ff" },
  violet: { stops: ["#8b5cf6", "#ec4899"], eye: "#fdf2fb" },
  forest: { stops: ["#14b8a6", "#84cc16"], eye: "#f4fce9" },
  midnight: { stops: ["#7b8ba6", "#2b3446"], eye: "#e2f5fb" },
};
const BOT_COLORWAYS = ["warm", "brand", "violet", "forest", "midnight"] as const;

/* ---------------- static "idle" SVG, matching the component's un-animated render ---------------- */

function svgFor(shape: (typeof BOT_SHAPES)[number], colorway: (typeof BOT_COLORWAYS)[number]): string {
  const cw = COLORWAYS[colorway];
  const d = pathFor(SHAPES[shape]);
  const gradientId = `g-${shape}-${colorway}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 216 216">
  <defs>
    <linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="18" y1="18" x2="182" y2="182">
      <stop offset="0%" stop-color="${cw.stops[0]}"/>
      <stop offset="100%" stop-color="${cw.stops[1]}"/>
    </linearGradient>
  </defs>
  <path d="${d}" fill="url(#${gradientId})"/>
  <g transform="translate(16,-12)">
    <circle cx="100" cy="100" r="22" fill="${cw.eye}"/>
  </g>
</svg>`;
}

/**
 * Base point size. The largest current call site is the New/Edit Bot sheet's
 * shape/colorway preview at BotAvatar size=64 (mobile/src/omg/bot-avatar.tsx),
 * with the creature inset to 0.62 of the container — the same inset ratio
 * AgentAvatar already uses for its disc-backed mark (components.tsx) — which
 * puts the largest on-screen creature at ~40pt. 44 covers that with a little
 * headroom and keeps the sizes round.
 */
const BASE = 44;
const DENSITIES: [suffix: string, scale: number][] = [
  ["", 1],
  ["@2x", 2],
  ["@3x", 3],
];

async function render(shape: (typeof BOT_SHAPES)[number], colorway: (typeof BOT_COLORWAYS)[number]) {
  const svg = svgFor(shape, colorway);
  for (const [suffix, scale] of DENSITIES) {
    const px = BASE * scale;
    await sharp(Buffer.from(svg), { density: 384 })
      .resize(px, px, { fit: "fill" })
      .png({ compressionLevel: 9, palette: true })
      .toFile(resolve(outDir, `bot-${shape}-${colorway}${suffix}.png`));
  }
}

await Promise.all(BOT_SHAPES.flatMap((shape) => BOT_COLORWAYS.map((colorway) => render(shape, colorway))));

console.log(`Wrote ${BOT_SHAPES.length * BOT_COLORWAYS.length * DENSITIES.length} PNGs to ${outDir}`);
