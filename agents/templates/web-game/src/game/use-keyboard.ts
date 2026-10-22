// Keyboard input. Writes into the shared Input object, the same one the
// on-screen controls write to. P1 = WASD + Space/E; in two-player mode
// P2 = arrows + Enter. Escape calls `onEscape` (pause).
import { useEffect } from "react";
import { keyToAction, releaseAll, setAction, type Input } from "./input";

export function useKeyboard(input: Input, players: 1 | 2, onEscape?: () => void): void {
  useEffect(() => {
    const handle = (down: boolean) => (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (e.key === "Escape") {
        if (down && !e.repeat) onEscape?.();
        return;
      }
      const m = keyToAction(e.key, players);
      if (!m) return;
      e.preventDefault(); // arrow keys and space must not scroll the page or press a focused button
      setAction(input, m.player, m.action, down);
    };
    const onDown = handle(true);
    const onUp = handle(false);
    const onBlur = () => releaseAll(input);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      releaseAll(input);
    };
  }, [input, players, onEscape]);
}
