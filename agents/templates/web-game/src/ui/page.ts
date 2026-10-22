// Page rules for a full-screen game on phones. Called once from main.tsx.
// styles.css does most of it (100dvh, no scroll, touch-action, safe areas);
// these are the parts CSS cannot do, plus the page-load events.
//
// The rounded font of Soft candy (Nunito, OFL, 39 KB) is bundled with the
// game. The browser downloads it only when the theme uses it. No font or
// script comes from another site.
import "@fontsource-variable/nunito/wght.css";
import { activeChallenge } from "./run";
import { unlockAudioOnFirstTap } from "./sound";
import { theme, type Theme } from "./theme";
import { track } from "./track";

const PX = new Set<keyof Theme>(["radiusCard", "radiusButton", "hardShadow", "pressY", "blur"]);

/** Write the theme tokens as CSS variables (--accent, --radiusCard, ...) on <html>. */
export function applyTheme(t: Theme = theme): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(t) as [keyof Theme, string | number][]) {
    root.style.setProperty(`--${name}`, PX.has(name) ? `${value}px` : String(value));
  }
  root.dataset.material = t.material;
  root.style.colorScheme = t.scheme;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", t.background);
}

export function installGamePage(): void {
  applyTheme();
  unlockAudioOnFirstTap();

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

  const challenge = activeChallenge();
  track("game_open", challenge ? { mode: "challenge" } : {});
  if (challenge) track("challenge_open", { score: challenge.score });
}
