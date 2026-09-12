/**
 * Hardware keyboard shortcuts (iPad with a keyboard, or a Mac running the app).
 *
 * Backed by react-native-key-command, whose UIKeyCommands reach UIKit through
 * the UIApplication category in modules/omg-key-commands. LOADED LAZILY AND
 * DEFENSIVELY: an over-the-air update carrying this file can land on a binary
 * built before the module existed, and `import`ing the package there throws
 * at module-evaluation time and takes the whole app down with it. So the
 * package is required only when its native side is present, and every hook
 * below is a no-op otherwise.
 */
import { useEffect, useRef } from "react";
import { NativeModules, Platform } from "react-native";

type KeyCommandLib = {
  constants: Record<string, string | number>;
  addListener: (
    command: { input: string; modifierFlags?: number | string },
    callback: () => void,
  ) => () => void;
};

let lib: KeyCommandLib | null | undefined;

function load(): KeyCommandLib | null {
  if (lib !== undefined) return lib;
  lib = null;
  if (Platform.OS !== "ios" || !NativeModules.KeyCommand) return lib;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lib = require("react-native-key-command") as KeyCommandLib;
  } catch {
    lib = null;
  }
  return lib;
}

/** True when the running binary can deliver key commands at all. */
export function keyCommandsAvailable(): boolean {
  return load() !== null;
}

export type Modifier = "command" | "commandShift" | "control" | "option" | "none";

const MODIFIER_KEY: Record<Modifier, string | null> = {
  command: "keyModifierCommand",
  commandShift: "keyModifierShiftCommand",
  control: "keyModifierControl",
  option: "keyModifierOption",
  none: null,
};

/** Special keys, named so call sites never spell UIKit's input strings. */
export type SpecialKey = "up" | "down" | "left" | "right" | "escape" | "enter";

const SPECIAL_KEY: Record<SpecialKey, string> = {
  up: "keyInputUpArrow",
  down: "keyInputDownArrow",
  left: "keyInputLeftArrow",
  right: "keyInputRightArrow",
  escape: "keyInputEscape",
  enter: "keyInputEnter",
};

export type KeyCommandSpec = {
  /** A character ("n", ",", "/") or a special key. */
  key: string | { special: SpecialKey };
  modifier?: Modifier;
};

function resolve(spec: KeyCommandSpec, constants: KeyCommandLib["constants"]) {
  const input =
    typeof spec.key === "string" ? spec.key : String(constants[SPECIAL_KEY[spec.key.special]] ?? "");
  const modifierKey = MODIFIER_KEY[spec.modifier ?? "command"];
  const modifierFlags = modifierKey ? constants[modifierKey] : undefined;
  return { input, modifierFlags };
}

/**
 * Register one shortcut while the component is mounted. `handler` is read
 * through a ref-like closure each render, so callers pass their latest
 * function without re-registering the native command every time.
 */
export function useKeyCommand(spec: KeyCommandSpec, handler: (() => void) | null | undefined) {
  const enabled = !!handler;
  const key = typeof spec.key === "string" ? spec.key : `special:${spec.key.special}`;
  const modifier = spec.modifier ?? "command";
  // The latest handler, without it being a dependency of the registration.
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const k = load();
    if (!k) return;
    const { input, modifierFlags } = resolve(spec, k.constants);
    if (!input) return;
    return k.addListener({ input, modifierFlags }, () => latest.current?.());
    // `spec` is decomposed into `key` and `modifier` so an inline object
    // literal at the call site does not re-register on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, modifier]);
}

/** The table the shortcuts sheet draws. One source, so it cannot drift from the bindings. */
export const SHORTCUTS: Array<{ keys: string; does: string; where: "Live" | "Chat" | "Anywhere" }> = [
  { keys: "⌘ N", does: "New session", where: "Anywhere" },
  { keys: "⌘ ↑ / ⌘ ↓", does: "Previous / next session", where: "Anywhere" },
  { keys: "⌘ 1 … 9", does: "Open the nth session", where: "Anywhere" },
  { keys: "⌘ .", does: "Interrupt the running agent", where: "Chat" },
  { keys: "⌘ ,", does: "Settings", where: "Anywhere" },
  { keys: "⌘ /", does: "Show these shortcuts", where: "Anywhere" },
  { keys: "Esc", does: "Close a sheet or menu", where: "Anywhere" },
  { keys: "Return", does: "Send (Shift-Return for a new line)", where: "Chat" },
  { keys: "⌘ Return", does: "Send the other way: steer on a queue-mode machine, queue on a steer-mode one", where: "Chat" },
];
