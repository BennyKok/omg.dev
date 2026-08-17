import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The omg.dev mascot, as a bot's avatar.
 *
 * Ported from the `docs/design/mascot/motion.html` prototype. The system is
 * one eye (the species) x a home shape (the individual) x motion (personality):
 * every shape is the same 12-point radial skeleton, so any shape can morph into
 * any other by lerping its radii, and the whole creature is one SVG path plus a
 * translated eye group. No filters, no per-frame layout reads.
 *
 * The creature is the colour: the silhouette itself carries the colorway
 * gradient and sits on whatever is behind it. There is no card, no plate, no
 * rounded background — the shape is the only thing drawn, so the same avatar
 * drops into a roster row, a chat header or a message gutter without bringing
 * a competing surface with it.
 *
 * Sizing is deliberately tiered. Above `DETAIL_MIN_PX` the full path animation
 * runs; below it the geometric detail does not read on screen anyway, so the
 * creature falls back to a cheap CSS scale-breathe and skips the tick loop
 * entirely. That keeps a long roster of 28px avatars from costing a per-frame
 * path rewrite each.
 */

export const BOT_SHAPES = ["circle", "squircle", "teardrop", "pebble", "hexagon"] as const;
export const BOT_COLORWAYS = ["warm", "brand", "violet", "forest", "midnight"] as const;
export type BotShape = (typeof BOT_SHAPES)[number];
export type BotColorway = (typeof BOT_COLORWAYS)[number];
export type BotMotionState = "idle" | "thinking" | "working" | "sleeping";

export const SHAPE_LABELS: Record<BotShape, string> = {
  circle: "Circle",
  squircle: "Squircle",
  teardrop: "Teardrop",
  pebble: "Pebble",
  hexagon: "Hexagon",
};

/**
 * Colorways paint the silhouette, not a card behind it, so every gradient has
 * to hold up as a small solid shape on both the light and the dark shell. The
 * near-black ends the card versions used would read as a hole punched in a
 * dark background, so each ramp keeps its identity but stays in mid-tone.
 * `eye` is the cutout colour, light against its own body.
 */
export const COLORWAYS: Record<
  BotColorway,
  { name: string; stops: [string, string]; eye: string }
> = {
  warm: { name: "Warm", stops: ["#f0a04b", "#b4451f"], eye: "#fff5e8" },
  brand: { name: "Brand", stops: ["#4d7cff", "#06b6d4"], eye: "#f0f8ff" },
  violet: { name: "Violet", stops: ["#8b5cf6", "#ec4899"], eye: "#fdf2fb" },
  forest: { name: "Forest", stops: ["#14b8a6", "#84cc16"], eye: "#f4fce9" },
  midnight: { name: "Midnight", stops: ["#7b8ba6", "#2b3446"], eye: "#e2f5fb" },
};

/* ---------------- geometry: 12-point radial silhouette ---------------- */

const N = 12;
const ANGLES = Array.from({ length: N }, (_, i) => -90 + i * (360 / N));
const R = 70;
const deg2rad = (d: number) => (d * Math.PI) / 180;
const angDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

const circle = ANGLES.map(() => R);

const squircle = ANGLES.map((a) => {
  const t = deg2rad(a);
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  return R / Math.pow(Math.pow(c, 4) + Math.pow(s, 4), 0.25);
});

// The point sits exactly on sample index 11 (240deg) so it reaches full
// amplitude instead of splitting across two neighbouring samples, and the
// narrow Gaussian keeps the falloff steep enough to survive Catmull-Rom.
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

// Deliberately non-repeating, unlike hexagon's strict alternation, so it reads
// as a lumpy asymmetric pebble rather than a soft hexagon.
const pebble = [0.92, 0.95, 1.2, 1.06, 0.84, 0.8, 0.9, 1.14, 1.24, 0.98, 0.86, 0.88].map(
  (f) => R * f,
);

// A true hexagon swings vertex-to-edge-midpoint by 1/cos(30deg) ~ 1.155, and
// that is very close to what this uses: 0.90-1.04 is a ratio of 1.16.
// Widening the swing to "help" the corners survive Catmull-Rom backfires —
// samples land exactly on alternating vertices and edge midpoints, so the
// spline turns any extra amplitude into six spikes. The earlier 0.84-1.06
// (ratio 1.26) read as a six-pointed star, which mattered little behind a
// gradient card and matters a lot now that the silhouette is the whole
// identity.
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

const perk = ANGLES.map(() => R * 1.08);
const tight = ANGLES.map(() => R * 0.86);
// Bottom-heavy resting mound. The pole stays close in value to its immediate
// neighbours: because samples are mirrored left/right, a pole much lower than
// its neighbours reads instantly as a cleft between two humps.
const puddle = [0.7, 0.74, 0.92, 1.08, 1.02, 0.9, 0.88, 0.9, 1.02, 1.08, 0.92, 0.74].map(
  (f) => R * f,
);

const SHAPES: Record<BotShape, number[]> = { circle, squircle, teardrop, pebble, hexagon };

function radiiToPoints(radii: number[], cx: number, cy: number): [number, number][] {
  return radii.map((r, i) => {
    const a = deg2rad(ANGLES[i]);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
  });
}

function smoothPath(pts: [number, number][]): string {
  const n = pts.length;
  // 6 is the standard cardinal-spline factor, but at only 12 points it swamps
  // the shape signal (hexagon vertices, the teardrop's point) into soft blobs.
  // 8 pulls control points closer to the polyline and keeps corners readable.
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

/* ---------------- motion states ---------------- */

type StateSpec = {
  radii: number[];
  pupil: { x: number; y: number };
  tilt: number;
  wobbleAmp: number;
  wobbleSpeed: number;
  dur: number;
  closed: boolean;
};

const STATES: Record<BotMotionState, StateSpec> = {
  idle: {
    radii: circle,
    pupil: { x: 16, y: -12 },
    tilt: 0,
    wobbleAmp: 0.05,
    wobbleSpeed: (2 * Math.PI) / 7,
    dur: 650,
    closed: false,
  },
  thinking: {
    radii: perk,
    pupil: { x: 2, y: -30 },
    tilt: -6,
    wobbleAmp: 0.03,
    wobbleSpeed: (2 * Math.PI) / 3.4,
    dur: 600,
    closed: false,
  },
  working: {
    radii: tight,
    pupil: { x: 4, y: 20 },
    tilt: 0,
    wobbleAmp: 0.08,
    wobbleSpeed: (2 * Math.PI) / 0.85,
    dur: 500,
    closed: false,
  },
  sleeping: {
    radii: puddle,
    pupil: { x: 0, y: -2 },
    tilt: 0,
    wobbleAmp: 0.02,
    wobbleSpeed: (2 * Math.PI) / 10,
    dur: 800,
    closed: true,
  },
};

/* ---------------- one shared rAF loop for every mounted creature ---------------- */

type Ticker = (tSec: number, now: number) => void;
const tickers = new Set<Ticker>();
let frame = 0;

function ensureLoop() {
  if (frame) return;
  const loop = (now: number) => {
    const tSec = now / 1000;
    for (const tick of tickers) tick(tSec, now);
    frame = tickers.size ? requestAnimationFrame(loop) : 0;
  };
  frame = requestAnimationFrame(loop);
}

function register(tick: Ticker): () => void {
  tickers.add(tick);
  ensureLoop();
  return () => {
    tickers.delete(tick);
    if (!tickers.size && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/** Below this, path detail doesn't read — a CSS breathe is the honest trade. */
const DETAIL_MIN_PX = 26;

/**
 * The eye is now a hole in the body rather than a dot under a body-coloured
 * lid, so closing it means squashing the eye itself. Not to zero: a sleeping
 * creature with no eye at all just looks like a bean, whereas a flat sliver
 * reads as a shut lid.
 */
const EYE_SHUT = "scaleY(0.14)";
const EYE_OPEN = "scaleY(1)";

export function BotAvatar({
  shape = "circle",
  colorway = "warm",
  size = 44,
  state = "idle",
  seed = 0,
  className,
  title,
}: {
  shape?: BotShape;
  colorway?: BotColorway;
  size?: number;
  state?: BotMotionState;
  /** Offsets breathing phase so a roster never falls into lockstep. */
  seed?: number;
  className?: string;
  title?: string;
}) {
  const gradientId = useId().replace(/:/g, "");
  const pathRef = useRef<SVGPathElement>(null);
  const eyeRef = useRef<SVGGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const pupilRef = useRef<SVGCircleElement>(null);
  const stateRef = useRef(state);
  const shapeRef = useRef(shape);

  const cw = COLORWAYS[colorway] ?? COLORWAYS.warm;
  const detailed = size >= DETAIL_MIN_PX;
  const restRadii = SHAPES[shape] ?? circle;

  // Keep the animation loop reading the latest props without re-subscribing.
  stateRef.current = state;
  shapeRef.current = shape;

  useEffect(() => {
    if (!detailed) return;
    const path = pathRef.current;
    const eye = eyeRef.current;
    const group = groupRef.current;
    const pupil = pupilRef.current;
    if (!path || !eye || !group || !pupil) return;

    const reduced = prefersReducedMotion();
    const phase = (seed % 10) * 0.7;
    // Each creature breathes on its own 6-9s period, so a row of them reads as
    // a shelf of individuals rather than a synchronised icon set.
    const period = 6 + ((seed % 7) / 7) * 3;

    let from = (SHAPES[shapeRef.current] ?? circle).slice();
    let to = from.slice();
    let last = from.slice();
    let t0 = 0;
    let dur = 0;
    let appliedState: BotMotionState | null = null;
    let appliedShape: BotShape | null = null;
    const gaze = { ...STATES[stateRef.current].pupil };

    if (reduced) {
      // Static idle pose: no wobble, no blink, no spring — but still the right
      // shape and the right pupil position for the current state.
      const spec = STATES[stateRef.current];
      const radii = (SHAPES[shapeRef.current] ?? circle).map(
        (v, i) => v * (spec.radii[i] / R),
      );
      path.setAttribute("d", pathFor(radii));
      eye.setAttribute("transform", `translate(${spec.pupil.x},${spec.pupil.y})`);
      pupil.style.transform = spec.closed ? EYE_SHUT : EYE_OPEN;
      return;
    }

    let blinkTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleBlink = () => {
      blinkTimer = setTimeout(() => {
        if (!STATES[stateRef.current].closed) {
          pupil.classList.remove("bot-blink");
          void pupil.getBoundingClientRect();
          pupil.classList.add("bot-blink");
        }
        scheduleBlink();
      }, 2200 + Math.random() * 4200);
    };
    scheduleBlink();

    const stop = register((tSec, now) => {
      const spec = STATES[stateRef.current];
      const home = SHAPES[shapeRef.current] ?? circle;
      // The state's radii are expressed relative to R, so a state deformation
      // (perk, tight, puddle) is applied as a ratio on top of the bot's own
      // home shape. Identity survives every state change.
      const target = home.map((v, i) => v * (spec.radii[i] / R));

      if (appliedState !== stateRef.current || appliedShape !== shapeRef.current) {
        from = last.slice();
        to = target;
        t0 = now;
        dur = spec.dur;
        appliedState = stateRef.current;
        appliedShape = shapeRef.current;
        group.style.transform = `rotate(${spec.tilt}deg)`;
        pupil.style.transform = spec.closed ? EYE_SHUT : EYE_OPEN;
      } else if (dur === 0) {
        to = target;
      }

      let radii: number[];
      if (dur > 0) {
        const p = Math.min(1, (now - t0) / dur);
        const eased = easeOutBack(p);
        radii = from.map((v, i) => v + (to[i] - v) * eased);
        if (p >= 1) dur = 0;
      } else {
        radii = to.slice();
      }
      radii = radii.map(
        (v, i) =>
          v * (1 + spec.wobbleAmp * Math.sin(tSec * spec.wobbleSpeed + phase + i * 0.55)),
      );
      last = radii;
      path.setAttribute("d", pathFor(radii));

      gaze.x = lerp(gaze.x, spec.pupil.x, 0.12);
      gaze.y = lerp(gaze.y, spec.pupil.y, 0.12);
      eye.setAttribute("transform", `translate(${gaze.x.toFixed(2)},${gaze.y.toFixed(2)})`);
    });

    // Breathing period varies per creature via the wobble phase seed above;
    // the shared loop keeps it to one rAF for the whole roster.
    void period;

    return () => {
      stop();
      if (blinkTimer) clearTimeout(blinkTimer);
    };
  }, [detailed, seed]);

  return (
    <svg
      // Tight to the silhouette. With the card gone there is nothing to pad
      // out to, so the creature gets the whole box and keeps the visual weight
      // the plate used to carry. The margin is what the widest pose needs:
      // the teardrop's spike, perked and mid-wobble.
      viewBox="-8 -8 216 216"
      width={size}
      height={size}
      className={cn("shrink-0", !detailed && "bot-breathe", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ animationDelay: `${(seed % 7) * 0.4}s` }}
    >
      <defs>
        {/* userSpaceOnUse, not the default bounding box: the silhouette
            changes size every frame, and a bbox gradient would slide its
            ramp around as the creature breathes. */}
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="18"
          y1="18"
          x2="182"
          y2="182"
        >
          <stop offset="0%" stopColor={cw.stops[0]} />
          <stop offset="100%" stopColor={cw.stops[1]} />
        </linearGradient>
      </defs>
      <g ref={groupRef} style={{ transformOrigin: "50% 50%", transition: "transform .5s ease" }}>
        <path ref={pathRef} d={pathFor(restRadii)} fill={`url(#${gradientId})`} />
        <g ref={eyeRef} transform="translate(16,-12)">
          <circle
            ref={pupilRef}
            cx="100"
            cy="100"
            r="22"
            fill={cw.eye}
            style={{
              transformBox: "fill-box",
              transformOrigin: "50% 50%",
              transform: EYE_OPEN,
            }}
          />
        </g>
      </g>
    </svg>
  );
}
