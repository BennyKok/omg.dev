// Input state for one or two players. Keyboard, d-pad, buttons, the
// joystick and the drag field all write here; game rules only read here. That is what makes the
// same game work with a keyboard on the web and with touch controls on a phone.
//
// No React and no DOM in this file.

export type PlayerId = "p1" | "p2";
export type Action = "left" | "right" | "up" | "down" | "a" | "b";

/**
 * How the player moves on a touch screen. `TouchControls` draws it, and the
 * menu hint and How to play text must name the same control.
 *   "drag":    drag anywhere on the play field (paddle, catch, runner, slingshot)
 *   "stick":   a joystick, bottom left (top-down, twin-stick, free movement)
 *   "dpad":    four arrow keys (grid moves: maze, snake, sokoban)
 *   "steer":   two big left and right keys (racing, lane switch)
 *   "buttons": only the action buttons (one-tap: flappy, jump, tap timing)
 */
export type ControlKind = "drag" | "stick" | "dpad" | "steer" | "buttons";

export type PlayerInput = {
  held: Record<Action, boolean>;
  /** Joystick vector, each part from -1 to 1. */
  stick: { x: number; y: number };
  /** Actions pressed since the last `endFrame`. Use for jump or fire. */
  tapped: Record<Action, boolean>;
  /** The finger on the drag field ("drag" controls, absolute mode), 0..1 across and down the play field. Null when no finger is down. */
  drag: { x: number; y: number } | null;
};

export type Input = Record<PlayerId, PlayerInput>;

const ACTIONS: Action[] = ["left", "right", "up", "down", "a", "b"];

function blankPlayer(): PlayerInput {
  const flags = () => Object.fromEntries(ACTIONS.map((a) => [a, false])) as Record<Action, boolean>;
  return { held: flags(), stick: { x: 0, y: 0 }, tapped: flags(), drag: null };
}

export function createInput(): Input {
  return { p1: blankPlayer(), p2: blankPlayer() };
}

export function setAction(input: Input, player: PlayerId, action: Action, down: boolean): void {
  const p = input[player];
  if (down && !p.held[action]) p.tapped[action] = true;
  p.held[action] = down;
}

export function setStick(input: Input, player: PlayerId, x: number, y: number): void {
  const len = Math.hypot(x, y);
  const k = len > 1 ? 1 / len : 1;
  input[player].stick.x = x * k;
  input[player].stick.y = y * k;
}

/** Where the finger is on the play field, 0..1, or null. Written by the drag field in absolute mode. */
export function setDragTarget(input: Input, player: PlayerId, at: { x: number; y: number } | null): void {
  input[player].drag = at ? { x: Math.min(1, Math.max(0, at.x)), y: Math.min(1, Math.max(0, at.y)) } : null;
}

/**
 * The finger position on the play field (0..1 across and down), or null.
 * For a paddle or a basket that sits under the finger:
 *   const t = dragTarget(input, "p1");
 *   if (t) basket.x = approach(basket.x, t.x * WORLD.w, SPEED * 3 * dt);
 *   else basket.x += axisX(input, "p1") * SPEED * dt;   // keyboard
 */
export function dragTarget(input: Input, player: PlayerId): { x: number; y: number } | null {
  return input[player].drag;
}

/** Move `current` toward `target` by at most `maxStep`. */
export function approach(current: number, target: number, maxStep: number): number {
  const d = target - current;
  return Math.abs(d) <= maxStep ? target : current + Math.sign(d) * maxStep;
}

/** Held, or pressed and released within one frame. A very quick tap still moves one step. */
const on = (p: PlayerInput, a: Action): boolean => p.held[a] || p.tapped[a];

/** Left/right as -1..1. The joystick wins when it is moved. */
export function axisX(input: Input, player: PlayerId): number {
  const p = input[player];
  if (Math.abs(p.stick.x) > 0.05) return p.stick.x;
  return (on(p, "right") ? 1 : 0) - (on(p, "left") ? 1 : 0);
}

/** Up/down as -1..1. Up is negative, as on the screen. */
export function axisY(input: Input, player: PlayerId): number {
  const p = input[player];
  if (Math.abs(p.stick.y) > 0.05) return p.stick.y;
  return (on(p, "down") ? 1 : 0) - (on(p, "up") ? 1 : 0);
}

/** True once per press. Call `endFrame` after the steps of a frame. */
export function wasTapped(input: Input, player: PlayerId, action: Action): boolean {
  return input[player].tapped[action];
}

export function endFrame(input: Input): void {
  for (const id of ["p1", "p2"] as const) for (const a of ACTIONS) input[id].tapped[a] = false;
}

export function releaseAll(input: Input): void {
  for (const id of ["p1", "p2"] as const) {
    const p = input[id];
    for (const a of ACTIONS) {
      p.held[a] = false;
      p.tapped[a] = false;
    }
    p.stick.x = 0;
    p.stick.y = 0;
    p.drag = null;
  }
}

/** Keyboard layout. In two-player mode P1 uses WASD and P2 uses the arrow keys. */
export function keyToAction(key: string, players: 1 | 2): { player: PlayerId; action: Action } | null {
  const k = key.length === 1 ? key.toLowerCase() : key;
  const wasd: Record<string, Action> = { w: "up", a: "left", s: "down", d: "right", " ": "a", e: "b" };
  const arrows: Record<string, Action> = { ArrowUp: "up", ArrowLeft: "left", ArrowDown: "down", ArrowRight: "right", Enter: "a", "/": "b" };
  if (players === 1) {
    const action = wasd[k] ?? arrows[k];
    return action ? { player: "p1", action } : null;
  }
  if (wasd[k]) return { player: "p1", action: wasd[k] };
  if (arrows[k]) return { player: "p2", action: arrows[k] };
  return null;
}
