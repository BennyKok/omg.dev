// Art slots shared by every screen: the title logo, the hero art, the score
// icon, item art and the screen background. Each one shows the game's image when
// src/app/art.ts has one, and placeholder art in the theme colours when it
// does not.
import type { CSSProperties } from "react";

export type GameArt = {
  logo?: string;
  background?: string;
  hero?: string;
  scoreIcon?: string;
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

/**
 * The art under the logo on the menu: the game's image (ART.hero), or plain
 * shapes in the theme colours. The shapes belong to no game, so a game that
 * forgot its hero art does not show another game's character.
 */
export function Hero({ image }: { image?: string }) {
  if (image) return <img className="hero-image" src={image} alt="" draggable={false} />;
  return (
    <svg className="hero-art" viewBox="0 0 240 150" aria-hidden="true">
      <ellipse cx="120" cy="136" rx="80" ry="9" fill="var(--ink)" opacity=".10" />
      <g className="hero-shape a"><rect x="30" y="62" width="48" height="48" rx="12" fill="var(--accent2)" transform="rotate(-12 54 86)" /></g>
      <g className="hero-shape b"><circle cx="120" cy="76" r="40" fill="var(--accent)" /><ellipse cx="106" cy="58" rx="11" ry="7" fill="#fff" opacity=".4" transform="rotate(-25 106 58)" /></g>
      <g className="hero-shape c"><path d="M192 58l26 46h-52z" fill="var(--good)" strokeLinejoin="round" stroke="var(--good)" strokeWidth="8" /></g>
    </svg>
  );
}

/** Item art for an unlock: the image, or a ball in the item's colour on a rounded tile. */
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
        </svg>
      )}
    </div>
  );
}
