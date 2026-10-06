import { useId } from "react";
import type { BoxyMood } from "../lib/connection-overlay";
import { cn } from "../lib/utils";

/**
 * Boxy, the omg.dev mascot: a hand-drawn ink computer with an amber pixel
 * face. The body is the same drawing as the boot splash in web/index.html.
 * Only the face changes with the mood. Motion lives in index.css under
 * `.boxy-*` and stops when the device asks for reduced motion.
 */

// The screen is a 13 x 8 grid of 6.4 px cells starting at (60, 51.6).
const FACES: Record<"idle" | "happy" | "blink" | "sleep" | "error", readonly string[]> = {
  idle: [
    ".............",
    "..##.....##..",
    "..##.....##..",
    "..##.....##..",
    ".............",
    ".....###.....",
  ],
  happy: [
    ".............",
    "..#.#...#.#..",
    ".#...#.#...#.",
    ".............",
    "....#...#....",
    ".....###.....",
  ],
  blink: [
    ".............",
    ".............",
    ".............",
    "..##.....##..",
    ".............",
    ".....###.....",
  ],
  sleep: [
    ".............",
    ".............",
    ".............",
    "..##.....##..",
    ".............",
    "......#......",
  ],
  error: [
    ".............",
    "..#.#...#.#..",
    "...#.....#...",
    "..#.#...#.#..",
    ".............",
    ".....###.....",
  ],
};

function Face({ rows, className }: { rows: readonly string[]; className?: string }) {
  const cells: Array<[number, number]> = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") cells.push([x, y]);
  });
  return (
    <g className={className}>
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={60 + x * 6.4} y={51.6 + y * 6.4} width={5.2} height={5.2} rx={1} />
      ))}
    </g>
  );
}

export function Boxy({
  mood,
  size = 96,
  className,
}: {
  mood: BoxyMood;
  size?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const grid = `boxy-grid-${id}`;
  const boil = `boxy-boil-${id}`;
  return (
    <svg
      viewBox="0 0 200 200"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-boxy-mood={mood}
      className={cn("boxy", `boxy-${mood}`, "overflow-visible", className)}
    >
      <defs>
        <pattern id={grid} x="59.4" y="51" width="6.4" height="6.4" patternUnits="userSpaceOnUse">
          <rect x=".6" y=".6" width="5.2" height="5.2" rx="1" fill="#ffb547" fillOpacity=".13" />
        </pattern>
        <filter id={boil} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves={2} seed="1">
            <animate attributeName="seed" values="1;2;3;4" dur=".5s" repeatCount="indefinite" calcMode="discrete" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="2.6" />
        </filter>
      </defs>
      <rect x="58" y="42" width="86" height="63" rx="6" fill="#1d1209" />
      <rect className="boxy-grid" x="58" y="42" width="86" height="63" rx="6" fill={`url(#${grid})`} />
      <g className="boxy-face" fill="#ffb547">
        {mood === "happy" ? <Face rows={FACES.happy} /> : null}
        {mood === "error" ? <Face rows={FACES.error} /> : null}
        {mood === "sleeping" ? <Face rows={FACES.sleep} /> : null}
        {mood === "booting" || mood === "searching" ? (
          <>
            <Face rows={FACES.idle} className="boxy-eyes-open" />
            <Face rows={FACES.blink} className="boxy-eyes-shut" />
          </>
        ) : null}
      </g>
      {mood === "booting" ? (
        <>
          <rect className="boxy-cover" x="58" y="42" width="86" height="63" rx="6" fill="#1d1209" />
          <rect className="boxy-crt" x="58" y="42" width="86" height="63" rx="6" fill="#ffb547" />
        </>
      ) : null}
      <g className="boxy-ink" filter={`url(#${boil})`}>
        <path d="M52 22C92 19 130 20 150 23C160 25 163 32 163 44L164 150C164 160 158 165 147 165L54 166C43 166 38 160 38 149L37 40C37 29 42 23 52 22Z" />
        <path d="M58 42C85 40 120 40 143 42L144 104C120 106 84 106 57 105Z" />
        <path d="M110 130L146 129M118 140L146 140M58 136C60 133 66 133 68 136M60 166L56 178M142 166L146 178M48 178L66 178M136 178L154 178" />
      </g>
      {mood === "sleeping" ? (
        <g className="boxy-zz">
          <path d="M170 26h10l-10 10h10" />
        </g>
      ) : null}
    </svg>
  );
}
