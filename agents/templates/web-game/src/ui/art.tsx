// Art slots shared by every screen: the title logo, the hero art, item art
// and the screen background. Each one shows the game's image when
// src/app/art.ts has one, and placeholder art in the theme colours when it
// does not.
import type { CSSProperties } from "react";

export type GameArt = {
  logo?: string;
  background?: string;
  hero?: string;
  items: Record<string, string | undefined>;
  sprites: Record<string, string | undefined>;
};

/** The game title as a logo: the image, or the name in the theme's logo lettering. */
export function Logo({ name, image }: { name: string; image?: string }) {
  if (image) return <img className="logo-image" src={image} alt={name} draggable={false} />;
  const words = name.split(/\s+/).filter(Boolean);
  return (
    <h1 className="logo" aria-label={name}>
      {words.map((w, i) => (
        <span key={i} className={`logo-word w${i % 2}`} aria-hidden="true">{w}</span>
      ))}
    </h1>
  );
}

/** The art under the logo on the menu. Placeholder: the runner between two coins. */
export function Hero({ image }: { image?: string }) {
  if (image) return <img className="hero-image" src={image} alt="" draggable={false} />;
  return (
    <svg className="hero-art" viewBox="0 0 240 150" aria-hidden="true">
      <ellipse cx="120" cy="136" rx="70" ry="9" fill="var(--ink)" opacity=".10" />
      <g className="hero-coin a"><HeroCoin x={40} y={78} r={22} /></g>
      <g className="hero-coin b"><HeroCoin x={200} y={60} r={17} /></g>
      <g className="hero-runner">
        <ellipse cx="120" cy="84" rx="44" ry="46" fill="var(--p1)" />
        <ellipse cx="120" cy="92" rx="44" ry="38" fill="#000" opacity=".08" />
        <ellipse cx="106" cy="58" rx="12" ry="8" fill="#fff" opacity=".4" transform="rotate(-25 106 58)" />
        <ellipse cx="132" cy="74" rx="22" ry="19" fill="#fff" />
        <ellipse cx="125" cy="74" rx="4.5" ry="7" fill="#2a2440" />
        <ellipse cx="140" cy="74" rx="4.5" ry="7" fill="#2a2440" />
        <ellipse cx="96" cy="128" rx="13" ry="8" fill="var(--p1)" />
        <ellipse cx="142" cy="128" rx="13" ry="8" fill="var(--p1)" />
      </g>
    </svg>
  );
}

function HeroCoin({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g>
      <circle cx={x} cy={y + r * 0.12} r={r} fill="color-mix(in srgb, var(--coin) 70%, #a35f00)" />
      <circle cx={x} cy={y} r={r} fill="var(--coin)" />
      <circle cx={x} cy={y} r={r * 0.7} fill="none" stroke="color-mix(in srgb, var(--coin) 72%, #a35f00)" strokeWidth={r * 0.1} />
      <path
        transform={`translate(${x} ${y}) scale(${r / 12})`}
        d="M0-6.2l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4-2.9-2.8 4-.6z"
        fill="#fff"
      />
    </g>
  );
}

/** Item art for an unlock: the image, or the item's colour on a rounded tile. */
export function ItemArt({ image, color, locked, label }: { image?: string; color?: string; locked?: boolean; label: string }) {
  return (
    <div className={`item-art${locked ? " locked" : ""}`} style={{ "--item": color ?? "var(--accent)" } as CSSProperties}>
      {image && !locked ? (
        <img src={image} alt={label} draggable={false} />
      ) : (
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <ellipse cx="50" cy="84" rx="26" ry="6" fill="#000" opacity=".12" />
          <ellipse cx="50" cy="52" rx="28" ry="30" fill={locked ? "color-mix(in srgb, var(--ink) 22%, var(--surface))" : "var(--item)"} />
          <ellipse cx="40" cy="36" rx="8" ry="5" fill="#fff" opacity=".45" transform="rotate(-25 40 36)" />
          {locked ? null : (
            <g>
              <ellipse cx="58" cy="48" rx="14" ry="12" fill="#fff" />
              <ellipse cx="53.5" cy="48" rx="3" ry="4.6" fill="#2a2440" />
              <ellipse cx="63" cy="48" rx="3" ry="4.6" fill="#2a2440" />
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
