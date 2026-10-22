// On-screen controls over the game. They write into the same Input object as
// the keyboard. Render <TouchControls> on every device: the pads and buttons
// show only on touch screens, and the drag field also takes a mouse drag.
//
//   <TouchControls input={input} players={1} kind={GAME.controls.kind} buttons={[{ action: "a", label: "Dash", icon: <IconDash /> }]} />
//   <TouchControls input={input} players={1} kind="drag" axes="x" />     drag anywhere to move left and right
//   <TouchControls input={input} players={2} kind="steer" />             P1 bottom left, P2 bottom right
//
// `kind` (see ControlKind in src/game/input.ts): "drag" (drag anywhere on the
// play field), "stick" (analog joystick), "dpad" (four keys), "steer" (two big
// left/right keys for racing), "buttons" (only the action buttons). Each
// control captures its own pointer, so several fingers work at once (stick +
// button, drag + button, or two players).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { dragPlayer, dragPosition, dragStick, type DragAxes, type Point } from "../game/drag";
import { setAction, setDragTarget, setStick, type Action, type ControlKind, type Input, type PlayerId } from "../game/input";
import { stickFromOffset } from "../game/stick";
import { testHook } from "../game/test-mode";
import { IconBack, IconNext } from "./icons";
import { useProfile } from "./profile-store";
import { theme } from "./theme";

/** True on a phone or tablet. Touch controls show only there; a desktop uses the keyboard. */
export function useTouchScreen(): boolean {
  const query = "(any-pointer: coarse)";
  const [touch, setTouch] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(query);
    const onChange = () => setTouch(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return touch;
}

export function HoldButton({ input, player, action, label, icon, size = 64, color, kind = "pad", onPress }: {
  input: Input; player: PlayerId; action: Action; label: string; icon?: ReactNode; size?: number; color?: string;
  /** "pad": a direction key. "action": a big round coloured button. */
  kind?: "pad" | "action";
  /** Called on each press, for a sound or a vibration. */
  onPress?: () => void;
}) {
  const [down, setDown] = useState(false);
  const press = (v: boolean) => {
    setAction(input, player, action, v);
    setDown(v);
    if (v) onPress?.();
  };
  // Release if the control goes away while a finger is still on it.
  useEffect(() => () => setAction(input, player, action, false), [input, player, action]);
  const style = { width: size, height: size, ...(color ? { "--btn": color } : null) } as CSSProperties;
  return (
    <div
      role="button"
      aria-label={label}
      data-control=""
      data-down={down ? "" : undefined}
      className={`hold-button ${kind}`}
      style={style}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        press(true);
      }}
      onPointerUp={() => press(false)}
      onPointerCancel={() => press(false)}
      onLostPointerCapture={() => press(false)}
    >
      {icon ?? null}
      {kind === "action" || !icon ? <span className="hold-label">{label}</span> : null}
    </div>
  );
}

export function ActionButton(props: { input: Input; player: PlayerId; action: Action; label: string; icon?: ReactNode; size?: number; color?: string; onPress?: () => void }) {
  return <HoldButton {...props} kind="action" size={props.size ?? 92} color={props.color ?? theme.accent} />;
}

const Arrow = ({ dir }: { dir: "up" | "down" | "left" | "right" }) => {
  const rot = { right: 0, down: 90, left: 180, up: 270 }[dir];
  return <IconNext style={{ transform: `rotate(${rot}deg)` }} />;
};

export function DPad({ input, player, size = 58 }: { input: Input; player: PlayerId; size?: number }) {
  const b = (action: "up" | "down" | "left" | "right") => <HoldButton input={input} player={player} action={action} label={action} icon={<Arrow dir={action} />} size={size} />;
  return (
    <div className="dpad" style={{ width: size * 3 + 8, height: size * 3 + 8 }}>
      {b("up")}
      <div className="control-row">
        {b("left")}
        <div style={{ width: size }} />
        {b("right")}
      </div>
      {b("down")}
    </div>
  );
}

export function SteerPad({ input, player, size = 72 }: { input: Input; player: PlayerId; size?: number }) {
  return (
    <div className="control-row">
      <HoldButton input={input} player={player} action="left" label="left" icon={<IconBack />} size={size} />
      <HoldButton input={input} player={player} action="right" label="right" icon={<IconNext />} size={size} />
    </div>
  );
}

export function Joystick({ input, player, size = 148 }: { input: Input; player: PlayerId; size?: number }) {
  const radius = size / 2 - 30;
  const knob = useRef<HTMLDivElement | null>(null);
  const pointer = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const move = (e: { clientX: number; clientY: number; currentTarget: HTMLDivElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = stickFromOffset(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), radius);
    setStick(input, player, s.x, s.y);
    if (knob.current) knob.current.style.transform = `translate(${s.knobX}px, ${s.knobY}px)`;
  };
  const end = () => {
    pointer.current = null;
    setActive(false);
    setStick(input, player, 0, 0);
    if (knob.current) knob.current.style.transform = "translate(0px, 0px)";
  };
  useEffect(() => () => setStick(input, player, 0, 0), [input, player]);
  return (
    <div
      role="slider"
      aria-label={`${player === "p1" ? "Move" : "Player 2 move"} stick`}
      aria-valuenow={0}
      data-control=""
      data-down={active ? "" : undefined}
      className="stick-base"
      style={{ width: size, height: size }}
      onPointerDown={(e) => {
        if (pointer.current !== null) return;
        e.preventDefault();
        pointer.current = e.pointerId;
        setActive(true);
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => {
        if (e.pointerId === pointer.current) move(e);
      }}
      onPointerUp={(e) => {
        if (e.pointerId === pointer.current) end();
      }}
      onPointerCancel={(e) => {
        if (e.pointerId === pointer.current) end();
      }}
      onLostPointerCapture={(e) => {
        if (e.pointerId === pointer.current) end();
      }}
    >
      {(["up", "right", "down", "left"] as const).map((d) => (
        <span key={d} className={`stick-chevron ${d}`} aria-hidden="true" />
      ))}
      <div ref={knob} className="stick-knob" />
    </div>
  );
}

export type ControlButton = { action: Action; label: string; icon?: ReactNode; onPress?: () => void };

function Pad({ kind, input, player }: { kind: ControlKind; input: Input; player: PlayerId }) {
  if (kind === "stick") return <Joystick input={input} player={player} />;
  if (kind === "steer") return <SteerPad input={input} player={player} />;
  if (kind === "dpad") return <DPad input={input} player={player} />;
  return null; // "drag" uses the whole field; "buttons" has no pad
}

/**
 * Drag anywhere on the play field. It covers the game area under the HUD and
 * the buttons, takes touch and mouse, and never scrolls the page.
 * "relative" (default): a floating stick at the point where the finger lands;
 *   rules read it with axisX/axisY. "absolute": the finger position; rules
 *   read it with dragTarget. `axes` limits the drag to "x" or "y".
 * Two players: a finger on the left half is P1, on the right half P2.
 */
export function DragField({ input, players, mode = "relative", axes = "xy", radius = 40 }: {
  input: Input; players: 1 | 2; mode?: "relative" | "absolute"; axes?: DragAxes; radius?: number;
}) {
  // One finger per player. Other fingers on the field are ignored.
  const fingers = useRef(new Map<number, { player: PlayerId; anchor: Point }>());
  const [rings, setRings] = useState<Record<string, Point>>({});
  const release = (player: PlayerId) => {
    setStick(input, player, 0, 0);
    setDragTarget(input, player, null);
  };
  useEffect(() => () => { release("p1"); release("p2"); }, [input]);
  const apply = (id: number, e: { clientX: number; clientY: number; currentTarget: HTMLDivElement }) => {
    const f = fingers.current.get(id);
    if (!f) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (mode === "absolute") {
      setDragTarget(input, f.player, dragPosition({ x: e.clientX, y: e.clientY }, rect));
      setRings((r) => ({ ...r, [f.player]: at }));
      return;
    }
    const s = dragStick(f.anchor, at, radius, axes);
    f.anchor = s.anchor;
    setStick(input, f.player, s.x, s.y);
    setRings((r) => ({ ...r, [f.player]: s.anchor }));
  };
  const end = (id: number) => {
    const f = fingers.current.get(id);
    if (!f) return;
    fingers.current.delete(id);
    release(f.player);
    setRings((r) => {
      const next = { ...r };
      delete next[f.player];
      return next;
    });
  };
  return (
    <div
      className="drag-field"
      data-control=""
      aria-hidden="true"
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const player = dragPlayer(e.clientX, rect, players);
        if ([...fingers.current.values()].some((f) => f.player === player)) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        fingers.current.set(e.pointerId, { player, anchor: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
        apply(e.pointerId, e);
      }}
      onPointerMove={(e) => apply(e.pointerId, e)}
      onPointerUp={(e) => end(e.pointerId)}
      onPointerCancel={(e) => end(e.pointerId)}
      onLostPointerCapture={(e) => end(e.pointerId)}
    >
      {Object.entries(rings).map(([player, p]) => (
        <span key={player} className="drag-ring" style={{ transform: `translate(${p.x}px, ${p.y}px)`, ...(players === 2 ? { borderColor: theme[player as PlayerId] } : null) }} />
      ))}
    </div>
  );
}

/**
 * The controls layer over the game. Render it on every device. One player:
 * the pad bottom left, the buttons bottom right. Two players: P1's pad bottom
 * left, P2's pad bottom right, and a smaller button beside each pad. The drag
 * field ("drag") covers the play field and also takes a mouse drag. Pads and
 * buttons show only on touch screens with touch controls on.
 * `data-control-kind` tells check:ui and check:play which control to test.
 */
export function TouchControls({ input, players, kind = "stick", buttons = [], mode, axes }: {
  input: Input; players: 1 | 2; kind?: ControlKind; buttons?: ControlButton[];
  /** "drag" only: "relative" (default) or "absolute". */
  mode?: "relative" | "absolute";
  /** "drag" only: "x", "y" or "xy" (default). */
  axes?: DragAxes;
}) {
  const touch = useTouchScreen();
  const shown = useProfile().settings.touchControls;
  useEffect(() => {
    if (!testHook) return;
    testHook.input = input;
    testHook.kind = kind;
  }, [input, kind]);
  const btn = (b: ControlButton, player: PlayerId, size?: number, color?: string) => (
    <ActionButton key={`${player}-${b.action}`} input={input} player={player} action={b.action} label={b.label} icon={b.icon} size={size} color={color} onPress={b.onPress} />
  );
  return (
    <>
      {kind === "drag" ? <DragField input={input} players={players} mode={mode} axes={axes} /> : null}
      <div className={`touch-controls${players === 2 ? " two" : ""}`} data-control-kind={kind}>
        {touch && shown ? (
          <>
            <div className="control-side">
              <Pad kind={kind} input={input} player="p1" />
              {players === 2 ? buttons.map((b) => btn(b, "p1", 64, theme.p1)) : null}
            </div>
            <div className="control-side right">
              {players === 2 ? (
                <>
                  {buttons.map((b) => btn(b, "p2", 64, theme.p2))}
                  <Pad kind={kind} input={input} player="p2" />
                </>
              ) : (
                buttons.map((b) => btn(b, "p1"))
              )}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
