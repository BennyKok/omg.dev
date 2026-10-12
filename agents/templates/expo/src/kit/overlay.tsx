// Dialogs and sheets that work the same on iOS, Android and web.
//
// Why: `Alert.alert` with buttons does nothing on react-native-web, and two
// `<Modal>`s open at once draw the second one BEHIND the first on web. This
// host draws one absolute layer above the app, and shows only the top item.
//
// Setup (once, in src/app/_layout.tsx): wrap the stack in <OverlayProvider>.
//
//   const confirm = useConfirm();
//   if (await confirm({ title: "Delete?", destructive: true })) remove();
//
//   const sheet = useSheet();
//   sheet.open(<MyForm onDone={sheet.close} />);   // replaces an open sheet
//
// Sheet content is a node fixed at open time. Put state inside the content
// component, not in the caller, so it updates while the sheet is open.
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type OverlayItem, pushOverlay, removeOverlay } from "./overlay-core";

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Content =
  | { kind: "sheet"; node: ReactNode }
  | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void };

type Api = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  openSheet: (node: ReactNode) => number;
  closeSheet: (id?: number) => void;
};

const Ctx = createContext<Api | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<OverlayItem<Content>[]>([]);
  const nextId = useRef(1);
  const sheetId = useRef<number | null>(null);

  const api = useMemo<Api>(() => ({
    confirm: (options) => new Promise<boolean>((resolve) => {
      const id = nextId.current++;
      setStack((s) => pushOverlay(s, { id, content: { kind: "confirm", options, resolve } }, false));
    }),
    openSheet: (node) => {
      const id = nextId.current++;
      const old = sheetId.current;
      sheetId.current = id;
      setStack((s) => {
        const without = old === null ? s : removeOverlay(s, old);
        return pushOverlay(without, { id, content: { kind: "sheet", node } }, false);
      });
      return id;
    },
    closeSheet: (id) => {
      const target = id ?? sheetId.current;
      if (target === null) return;
      if (sheetId.current === target) sheetId.current = null;
      setStack((s) => removeOverlay(s, target));
    },
  }), []);

  const top = stack[stack.length - 1];
  function answer(item: OverlayItem<Content>, ok: boolean) {
    if (item.content.kind === "confirm") item.content.resolve(ok);
    setStack((s) => removeOverlay(s, item.id));
  }

  return (
    <Ctx.Provider value={api}>
      <View style={styles.flex}>
        {children}
        {top ? (
          <View key={top.id} style={styles.layer}>
            <Pressable
              accessibilityLabel="Close"
              onPress={() => (top.content.kind === "confirm" ? answer(top, false) : api.closeSheet(top.id))}
              style={styles.backdrop}
            />
            {top.content.kind === "sheet" ? (
              <View style={styles.sheet}>{top.content.node}</View>
            ) : (
              <ConfirmCard onAnswer={(ok) => answer(top, ok)} options={top.content.options} />
            )}
          </View>
        ) : null}
      </View>
    </Ctx.Provider>
  );
}

function ConfirmCard({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (ok: boolean) => void }) {
  return (
    <View accessibilityViewIsModal style={styles.card}>
      <Text style={styles.title}>{options.title}</Text>
      {options.message ? <Text style={styles.message}>{options.message}</Text> : null}
      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" onPress={() => onAnswer(false)} style={styles.button}>
          <Text style={styles.buttonText}>{options.cancelLabel ?? "Cancel"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onAnswer(true)}
          style={[styles.button, options.destructive ? styles.danger : styles.primary]}
        >
          <Text style={[styles.buttonText, styles.onColor]}>{options.confirmLabel ?? (options.destructive ? "Delete" : "OK")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function useApi(): Api {
  const api = useContext(Ctx);
  if (!api) throw new Error("Wrap the app in <OverlayProvider> (src/app/_layout.tsx).");
  return api;
}

/** Resolves true on confirm, false on cancel or backdrop press. */
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  return useApi().confirm;
}

export function useSheet(): { open: (node: ReactNode) => number; close: (id?: number) => void } {
  const { openSheet, closeSheet } = useApi();
  const open = useCallback((node: ReactNode) => openSheet(node), [openSheet]);
  return { open, close: closeSheet };
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  layer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000, justifyContent: "center", padding: 24 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "85%", backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  card: { alignSelf: "center", width: "100%", maxWidth: 380, backgroundColor: "#fff", borderRadius: 18, padding: 20, gap: 8 },
  title: { fontSize: 18, fontWeight: "700", color: "#191724" },
  message: { fontSize: 15, color: "#4a4655" },
  buttons: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 12 },
  button: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: "#eee9e3" },
  primary: { backgroundColor: "#191724" },
  danger: { backgroundColor: "#d92d20" },
  buttonText: { fontSize: 15, fontWeight: "600", color: "#191724" },
  onColor: { color: "#fff" },
});
