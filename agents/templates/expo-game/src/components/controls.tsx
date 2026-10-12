// On-screen controls. They write into the same Input object as the keyboard.
//
//   <TouchControls input={input} players={1} />                  d-pad left, A/B right
//   <TouchControls input={input} players={2} kind="steer" />     split: P1 left half, P2 right half
//   <Joystick input={input} player="p1" />                       analog stick
//   <ActionButton input={input} player="p1" action="a" label="JUMP" />
//
// Use `kind="dpad" | "stick" | "steer"`. Steer is two big left/right buttons
// (racing games). Pressable's onPressIn/onPressOut keep a button held while the
// finger is down, on touch screens and with a mouse.
import { useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { setAction, setStick, type Action, type Input, type PlayerId } from "../game/input";
import { theme } from "../game/theme";

const noSelect = { userSelect: "none", touchAction: "none" } as object;

export function HoldButton({ input, player, action, label, size = 64, color, wide }: {
  input: Input; player: PlayerId; action: Action; label: string; size?: number; color?: string; wide?: boolean;
}) {
  const [down, setDown] = useState(false);
  const press = (v: boolean) => { setAction(input, player, action, v); setDown(v); };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${player} ${action}`}
      onPressIn={() => press(true)}
      onPressOut={() => press(false)}
      style={[
        styles.btn,
        noSelect,
        { width: wide ? size * 1.9 : size, height: size, borderRadius: size / 2.4, backgroundColor: color ?? theme.surface, opacity: down ? 0.7 : 1 },
        down && { transform: [{ scale: 0.94 }] },
      ]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

export function ActionButton(props: { input: Input; player: PlayerId; action: Action; label: string; size?: number; color?: string }) {
  return <HoldButton {...props} size={props.size ?? 72} color={props.color ?? theme.accent} />;
}

export function DPad({ input, player, size = 58 }: { input: Input; player: PlayerId; size?: number }) {
  const b = (action: Action, label: string) => <HoldButton input={input} player={player} action={action} label={label} size={size} />;
  return (
    <View style={{ width: size * 3 + 8, height: size * 3 + 8, justifyContent: "space-between", alignItems: "center" }}>
      {b("up", "▲")}
      <View style={styles.row}>
        {b("left", "◀")}
        <View style={{ width: size }} />
        {b("right", "▶")}
      </View>
      {b("down", "▼")}
    </View>
  );
}

export function SteerPad({ input, player, size = 72 }: { input: Input; player: PlayerId; size?: number }) {
  return (
    <View style={styles.row}>
      <HoldButton input={input} player={player} action="left" label="◀" size={size} wide />
      <HoldButton input={input} player={player} action="right" label="▶" size={size} wide />
    </View>
  );
}

export function Joystick({ input, player, size = 132 }: { input: Input; player: PlayerId; size?: number }) {
  const radius = size / 2 - 22;
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const start = useRef({ x: 0, y: 0 });
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        start.current = { x: e.nativeEvent.locationX - size / 2, y: e.nativeEvent.locationY - size / 2 };
        move(0, 0);
      },
      onPanResponderMove: (_e, g) => move(g.dx, g.dy),
      onPanResponderRelease: () => end(),
      onPanResponderTerminate: () => end(),
    }),
  ).current;
  function move(dx: number, dy: number) {
    const x = start.current.x + dx;
    const y = start.current.y + dy;
    const len = Math.hypot(x, y);
    const k = len > radius ? radius / len : 1;
    setKnob({ x: x * k, y: y * k });
    setStick(input, player, (x * k) / radius, (y * k) / radius);
  }
  function end() {
    setKnob({ x: 0, y: 0 });
    setStick(input, player, 0, 0);
  }
  return (
    <View {...pan.panHandlers} style={[styles.stickBase, noSelect, { width: size, height: size, borderRadius: size / 2 }]}>
      <View pointerEvents="none" style={[styles.stickKnob, { transform: [{ translateX: knob.x }, { translateY: knob.y }] }]} />
    </View>
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
    <View style={styles.bar} pointerEvents="box-none">
      <View style={styles.side}>
        <Pad kind={kind} input={input} player="p1" />
        {players === 2 ? buttons.map((b) => <ActionButton key={b.action} input={input} player="p1" action={b.action} label={b.label} size={56} color={theme.p1} />) : null}
      </View>
      <View style={styles.side}>
        {players === 2 ? (
          <>
            {buttons.map((b) => <ActionButton key={b.action} input={input} player="p2" action={b.action} label={b.label} size={56} color={theme.p2} />)}
            <Pad kind={kind} input={input} player="p2" />
          </>
        ) : (
          buttons.map((b) => <ActionButton key={b.action} input={input} player="p1" action={b.action} label={b.label} />)
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
  side: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  btn: { alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: theme.surfaceBorder },
  btnText: { color: theme.ink, fontWeight: "900", fontSize: 18 },
  stickBase: { backgroundColor: theme.surface, borderWidth: 2, borderColor: theme.surfaceBorder, alignItems: "center", justifyContent: "center" },
  stickKnob: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.accent },
});
