// Page rules for a full-screen game on phones. Called once from main.tsx.
// styles.css does most of it (no scroll, touch-action, safe areas); these are
// the parts CSS cannot do.
import { theme } from "./theme";

export function installGamePage(): void {
  // theme.ts is the one place for colours: expose it to CSS as --background, --accent, ...
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme)) root.style.setProperty(`--${name}`, value);

  // iOS Safari ignores user-scalable=no. Block its pinch gesture and two-finger zoom.
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  // A long press on the game or a control must not open the copy/save menu.
  document.addEventListener("contextmenu", (e) => {
    if ((e.target as Element | null)?.closest?.("canvas, [data-control]")) e.preventDefault();
  });
}
