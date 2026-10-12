// Keyboard input on the web. Does nothing on a phone. Writes into the shared
// Input object, the same one the on-screen controls write to.
import { useEffect } from "react";
import { Platform } from "react-native";
import { keyToAction, releaseAll, setAction, type Input } from "./input";

type KeyTarget = {
  addEventListener(type: string, fn: (e: { key: string; preventDefault(): void }) => void): void;
  removeEventListener(type: string, fn: (e: { key: string; preventDefault(): void }) => void): void;
};

export function useKeyboard(input: Input, players: 1 | 2, onEscape?: () => void): void {
  useEffect(() => {
    const target = (globalThis as unknown as { window?: KeyTarget & { addEventListener(type: "blur", fn: () => void): void } }).window;
    if (Platform.OS !== "web" || !target) return;
    const handle = (down: boolean) => (e: { key: string; preventDefault(): void }) => {
      if (e.key === "Escape") {
        if (down) onEscape?.();
        return;
      }
      const m = keyToAction(e.key, players);
      if (!m) return;
      e.preventDefault(); // arrow keys and space must not scroll the page
      setAction(input, m.player, m.action, down);
    };
    const onDown = handle(true);
    const onUp = handle(false);
    const onBlur = () => releaseAll(input);
    target.addEventListener("keydown", onDown);
    target.addEventListener("keyup", onUp);
    target.addEventListener("blur", onBlur as never);
    return () => {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur as never);
      releaseAll(input);
    };
  }, [input, players, onEscape]);
}
