// Art slots for this game. Every slot is optional: an empty slot shows the
// kit's placeholder art in the theme colours, so the game always looks
// finished. Fill a slot with an image URL:
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
  /** The character or scene under the logo on the menu. Placeholder: the runner and coins. */
  hero: undefined,
  /** One image per unlock id, square. Placeholder: the item's colour on a rounded tile. */
  items: {},
  /** Images for the game world, drawn in 2D and as camera-facing sprites in 3D. Placeholder: shapes. */
  sprites: {
    player: undefined,
    coin: undefined,
    hazard: undefined,
  },
};
