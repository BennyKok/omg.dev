// On-screen controls. They write into the same Input object as the keyboard.
//
//   <TouchControls input={input} players={1} />                  d-pad left, A/B right
//   <TouchControls input={input} players={2} kind="steer" />     split: P1 left half, P2 right half
//   <Joystick input={input} player="p1" />                       analog stick
//   <ActionButton input={input} player="p1" action="a" label="JUMP" />
//
// Use `kind="dpad" | "stick" | "steer"`. Steer is two big left/right buttons
// (racing games). Each control captures its own pointer, so several fingers
// work at once (stick + button, or two players), with touch, pen or mouse.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { setAction, setStick, type Action, type Input, type PlayerId } from "../game/input";
import { stickFromOffset } from "../game/stick";
import { theme } from "../game/theme";

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

export function HoldButton({ input, player, action, label, size = 64, color, wide }: {
  input: Input; player: PlayerId; action: Action; label: string; size?: number; color?: string; wide?: boolean;
}) {
  const [down, setDown] = useState(false);
  const press = (v: boolean) => {
    setAction(input, player, action, v);
    setDown(v);
  };
  // Release if the control goes away while a finger is still on it.
  useEffect(() => () => setAction(input, player, action, false), [input, player, action]);
  const style: CSSProperties = {
    width: wide ? size * 1.9 : size,
    height: size,
    borderRadius: size / 2.4,
    background: color ?? theme.surface,
  };
  return (
    <div
      role="button"
      aria-label={`${player} ${action}`}
      data-control=""
      data-down={down ? "" : undefined}
      className="hold-button"
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
      {label}
    </div>
  );
}

export function ActionButton(props: { input: Input; player: PlayerId; action: Action; label: string; size?: number; color?: string }) {
  return <HoldButton {...props} size={props.size ?? 72} color={props.color ?? theme.accent} />;
}

export function DPad({ input, player, size = 58 }: { input: Input; player: PlayerId; size?: number }) {
  const b = (action: Action, label: string) => <HoldButton input={input} player={player} action={action} label={label} size={size} />;
  return (
    <div className="dpad" style={{ width: size * 3 + 8, height: size * 3 + 8 }}>
      {b("up", "▲")}
      <div className="control-row">
        {b("left", "◀")}
        <div style={{ width: size }} />
        {b("right", "▶")}
      </div>
      {b("down", "▼")}
    </div>
  );
}

export function SteerPad({ input, player, size = 72 }: { input: Input; player: PlayerId; size?: number }) {
  return (
    <div className="control-row">
      <HoldButton input={input} player={player} action="left" label="◀" size={size} wide />
      <HoldButton input={input} player={player} action="right" label="▶" size={size} wide />
    </div>
  );
}

export function Joystick({ input, player, size = 132 }: { input: Input; player: PlayerId; size?: number }) {
  const radius = size / 2 - 22;
  const knob = useRef<HTMLDivElement | null>(null);
  const pointer = useRef<number | null>(null);
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const s = stickFromOffset(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), radius);
    setStick(input, player, s.x, s.y);
    if (knob.current) knob.current.style.transform = `translate(${s.knobX}px, ${s.knobY}px)`;
  };
  const end = () => {
    pointer.current = null;
    setStick(input, player, 0, 0);
    if (knob.current) knob.current.style.transform = "translate(0px, 0px)";
  };
  useEffect(() => () => setStick(input, player, 0, 0), [input, player]);
  return (
    <div
      role="slider"
      aria-label={`${player} stick`}
      aria-valuenow={0}
      data-control=""
      className="stick-base"
      style={{ width: size, height: size, borderRadius: size / 2 }}
      onPointerDown={(e) => {
        if (pointer.current !== null) return;
        e.preventDefault();
        pointer.current = e.pointerId;
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
      <div ref={knob} className="stick-knob" />
    </div>
  );
}

export type PadKind = "dpad" | "stick" | "steer";

function Pad({ kind, input, player }: { kind: PadKind; input: Input; player: PlayerId }) {
  if (kind === "stick") return <Joystick input={input} player={player} />;
  if (kind === "steer") return <SteerPad input={input} player={player} />;
  return <DPad input={input} player={player} />;
}

/**
 * Bottom control bar. One player: movement pad on the left, buttons on the
 * right. Two players: P1's pad on the left, P2's pad on the right, no buttons
 * (pass `buttons` to add a button per player).
 */
export function TouchControls({ input, players, kind = "dpad", buttons = [] }: {
  input: Input; players: 1 | 2; kind?: PadKind; buttons?: { action: Action; label: string }[];
}) {
  return (
    <div className="touch-controls">
      <div className="control-side">
        <Pad kind={kind} input={input} player="p1" />
        {players === 2 ? buttons.map((b) => <ActionButton key={b.action} input={input} player="p1" action={b.action} label={b.label} size={56} color={theme.p1} />) : null}
      </div>
      <div className="control-side">
        {players === 2 ? (
          <>
            {buttons.map((b) => <ActionButton key={b.action} input={input} player="p2" action={b.action} label={b.label} size={56} color={theme.p2} />)}
            <Pad kind={kind} input={input} player="p2" />
          </>
        ) : (
          buttons.map((b) => <ActionButton key={b.action} input={input} player="p1" action={b.action} label={b.label} />)
        )}
      </div>
    </div>
  );
}
