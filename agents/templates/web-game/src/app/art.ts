// Art slots for this game. An empty slot shows plain kit shapes in the theme
// colours. The files in public/art/ are the Coin Dash SAMPLE art: replace
// them (and public/icons/, public/og.png) with your game's art before you
// publish. check:play fails while any sample file is still on the page.
// Fill a slot with an image URL:
//
//   import logo from "../assets/logo.png";      // bundled by Vite (hashed name)
//   logo: logo,
//   background: "/art/menu-bg.jpg",             // or a file in public/
//
// Use transparent PNGs for the logo, hero, items and sprites. Keep the whole
// game under 3 MB: about 200 KB for a background, 30 KB for an item.
import type { GameArt } from "../ui/art";

export const ART: GameArt = {
  /** The title logo on the menu, about 600 x 360. Placeholder: the game name in the theme's logo style. */
  logo: undefined,
  /** Behind the menu, results and unlocks screens, portrait, about 1080 x 1920. Placeholder: theme gradient and shapes. */
  background: undefined,
  /** The character or scene under the logo on the menu, about 480 x 300. Empty: plain shapes. */
  hero: "/art/hero.svg",
  /** The score item in the HUD (what the player collects), square, about 64 x 64. Empty: a plain star. */
  scoreIcon: "/art/score.svg",
  /** One image per unlock id, square. Placeholder: the item's colour on a rounded tile. */
  items: {},
  /** Images for the game world, drawn in 2D and as camera-facing sprites in 3D. Placeholder: shapes. */
  sprites: {
    player: undefined,
    coin: undefined,
    hazard: undefined,
  },
};
