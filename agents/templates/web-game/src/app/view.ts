// The renderer of the game: 2D or 3D. Change this ONE line to switch.
//
//   2D canvas:  import("../games/coin-dash/view-2d")
//   3D three.js: import("../games/coin-dash/view-3d")
//
// Both files draw the same game from the same logic.ts. The import is
// dynamic, so a 2D game never downloads three.js, and the menu starts the
// download early (preloadView) so Play opens at once.
import type { ViewModule } from "../game/view";
import type { Game } from "../games/coin-dash/logic";

export const loadView = (): Promise<ViewModule<Game>> => import("../games/coin-dash/view-2d");

/** Start downloading the view while the menu shows. Safe to call many times. */
export function preloadView(): void {
  void loadView().catch(() => {});
}
