/**
 * The composer's "+" menu: the NATIVE menu, with its trigger lifted out of the
 * glass.
 *
 * WHY THE TRIGGER CANNOT LIVE IN THE GLASS. The "+" sits inside the composer's
 * Liquid Glass surface. On iOS 26 a system menu presented from inside a glass
 * view morphs THAT GLASS into the menu, so pressing "+" made the whole
 * composer turn into the Photo Library / Take Photo / Choose File list and
 * vanish (reported with a screenshot, 2026-09-24).
 *
 * An app-drawn card fixed that and was rejected: Benny wants the system menu.
 * So the menu stays native and only its ANCHOR moves. `AttachMenuLayer` wraps
 * the glass; `AttachMenuButton` leaves an empty slot where the "+" belongs and
 * the layer draws the real trigger on top of that slot, as a SIBLING of the
 * glass rather than a child of it. The menu then grows from the "+" alone.
 *
 * Without a layer (Android, or an OS with no Liquid Glass, or a caller that
 * never wrapped one) the button is the plain inline DropdownMenu it always was.
 */
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { type HostInstance, type StyleProp, View, type ViewStyle } from "react-native";

import { LIQUID_GLASS } from "./glass";
import { DropdownMenu, type MenuOption } from "./menu";

type Slot = { x: number; y: number; size: number; options: MenuOption[]; glyph: ReactNode };

type Layer = {
  host: RefObject<HostInstance | null>;
  set: (id: string, slot: Slot | null) => void;
  /** Bumped whenever the layer resizes, so every slot measures again. */
  tick: number;
};

const LayerContext = createContext<Layer | null>(null);

function Trigger({ size, options, glyph }: { size: number; options: MenuOption[]; glyph: ReactNode }) {
  return (
    <DropdownMenu options={options} style={{ width: size, height: size }}>
      <View
        accessibilityRole="button"
        accessibilityLabel="Attach a file"
        testID="composer-attach"
        style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
      >
        {glyph}
      </View>
    </DropdownMenu>
  );
}

/** Wrap the composer's glass surface in this. It draws the "+" over the glass. */
export function AttachMenuLayer({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const host = useRef<HostInstance>(null);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [tick, setTick] = useState(0);
  const set = useCallback((id: string, slot: Slot | null) => {
    setSlots((prev) => {
      if (!slot) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: slot };
    });
  }, []);
  const value = useMemo(() => ({ host, set, tick }), [set, tick]);
  if (!LIQUID_GLASS) return <View style={style}>{children}</View>;
  return (
    <LayerContext.Provider value={value}>
      <View
        ref={host}
        collapsable={false}
        style={style}
        // The glass grows with the text, which moves the slot inside it
        // without the slot's own frame (relative to ITS parent) changing.
        onLayout={() => setTick((n) => n + 1)}
      >
        {children}
        {Object.entries(slots).map(([id, slot]) => (
          <View key={id} style={{ position: "absolute", left: slot.x, top: slot.y, zIndex: 2 }}>
            <Trigger size={slot.size} options={slot.options} glyph={slot.glyph} />
          </View>
        ))}
      </View>
    </LayerContext.Provider>
  );
}

export function AttachMenuButton({
  options,
  size,
  children,
}: {
  options: MenuOption[];
  size: number;
  /** The "+" glyph. */
  children: ReactNode;
}) {
  const layer = useContext(LayerContext);
  const id = useId();
  const slot = useRef<HostInstance>(null);
  const latest = useRef({ options, children, size });
  latest.current = { options, children, size };

  const measure = useCallback(() => {
    const target = layer?.host.current;
    if (!layer || !target || !slot.current) return;
    slot.current.measureLayout(target, (x, y) => {
      const { options: rows, children: glyph, size: side } = latest.current;
      layer.set(id, { x, y, size: side, options: rows, glyph });
    });
  }, [layer, id]);

  // Re-publish when the rows change (they carry the picker callbacks) and
  // whenever the layer resizes.
  useEffect(measure, [measure, options, layer?.tick]);
  useEffect(() => () => layer?.set(id, null), [layer, id]);

  if (!layer) return <Trigger size={size} options={options} glyph={children} />;
  return (
    <View
      ref={slot}
      collapsable={false}
      onLayout={measure}
      style={{ width: size, height: size }}
    />
  );
}
