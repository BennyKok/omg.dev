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

export const COLORWAYS: Record<
  BotColorway,
  { name: string; stops: [string, string]; body: string; pupil: string }
> = {
  warm: { name: "Warm", stops: ["#7a4127", "#150b08"], body: "#f7f2e9", pupil: "#241811" },
  brand: { name: "Brand", stops: ["#3b5bf6", "#06b6d4"], body: "#eef6ff", pupil: "#123a6b" },
  violet: { name: "Violet", stops: ["#7c3aed", "#ec4899"], body: "#faf1fb", pupil: "#3b0764" },
  forest: { name: "Forest", stops: ["#0d9488", "#a3e635"], body: "#f2fbe8", pupil: "#14432a" },
  midnight: { name: "Midnight", stops: ["#2c2c2e", "#0a0a0b"], body: "#dffbf9", pupil: "#083344" },
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

// A true hexagon swings vertex-to-edge-midpoint by 1/cos(30deg) ~ 1.155.
// Catmull-Rom rounds that off, so the swing is widened a little to keep the
// vertices legible — but only a little: the prototype's 0.75-1.10 (a ratio of
// 1.47, well past a real hexagon) reads as a six-pointed star at avatar size,
// which is what this actually renders at. 0.84-1.06 keeps corners visible at
// 38px while still reading hexagonal rather than spiky.
const hexagon = (() => {
  const period = Math.PI / 3;
  return ANGLES.map((a) => {
    const t = deg2rad(a);
    const m = ((t % period) + period) % period;
    const raw = Math.cos(Math.PI / 6) / Math.cos(m - Math.PI / 6);
    const norm = (raw - 0.866) / (1 - 0.866);
    return R * (0.84 + 0.22 * norm);
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
  const lidRef = useRef<SVGEllipseElement>(null);
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
    const lid = lidRef.current;
    if (!path || !eye || !group || !lid) return;

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
    const pupil = { ...STATES[stateRef.current].pupil };

    if (reduced) {
      // Static idle pose: no wobble, no blink, no spring — but still the right
      // shape and the right pupil position for the current state.
      const spec = STATES[stateRef.current];
      const radii = (SHAPES[shapeRef.current] ?? circle).map(
        (v, i) => v * (spec.radii[i] / R),
      );
      path.setAttribute("d", pathFor(radii));
      eye.setAttribute("transform", `translate(${spec.pupil.x},${spec.pupil.y})`);
      lid.style.transform = spec.closed ? "scaleY(1)" : "scaleY(0)";
      return;
    }

    let blinkTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleBlink = () => {
      blinkTimer = setTimeout(() => {
        if (!STATES[stateRef.current].closed) {
          lid.classList.remove("bot-blink");
          void lid.getBoundingClientRect();
          lid.classList.add("bot-blink");
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
        lid.style.transform = spec.closed ? "scaleY(1)" : "scaleY(0)";
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

      pupil.x = lerp(pupil.x, spec.pupil.x, 0.12);
      pupil.y = lerp(pupil.y, spec.pupil.y, 0.12);
      eye.setAttribute("transform", `translate(${pupil.x.toFixed(2)},${pupil.y.toFixed(2)})`);
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
      viewBox="-20 -20 240 240"
      width={size}
      height={size}
      className={cn("shrink-0", !detailed && "bot-breathe", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ animationDelay: `${(seed % 7) * 0.4}s` }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={cw.stops[0]} />
          <stop offset="100%" stopColor={cw.stops[1]} />
        </linearGradient>
      </defs>
      <rect x="-20" y="-20" width="240" height="240" rx="55" fill={`url(#${gradientId})`} />
      <g ref={groupRef} style={{ transformOrigin: "50% 50%", transition: "transform .5s ease" }}>
        <path ref={pathRef} d={pathFor(restRadii)} fill={cw.body} />
        <g ref={eyeRef} transform="translate(16,-12)">
          <circle cx="100" cy="100" r="16" fill={cw.pupil} />
          <ellipse
            ref={lidRef}
            cx="100"
            cy="100"
            rx="30"
            ry="32"
            fill={cw.body}
            style={{ transformBox: "fill-box", transformOrigin: "50% 50%", transform: "scaleY(0)" }}
          />
        </g>
      </g>
    </svg>
  );
}
