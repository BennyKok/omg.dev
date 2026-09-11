/**
 * THE FOLDER RAIL, ARRANGED. Long-press a pill on Live and this card lists
 * every folder the machine has: move one up or down, take it off the rail or
 * put it back, add an existing folder from the machine, or make a new one.
 * Order and hidden set live on the device (see STORAGE_KEYS.folderRail).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, type GestureResponderEvent } from "react-native";

import Reanimated, { Easing, LinearTransition } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import type { AndroidSymbol, SFSymbol } from "expo-symbols";

import { Icon } from "../components";
import { Sheet } from "./sheet";
import { PressableScale } from "./motion";
import { useOmg } from "./provider";
import type { FolderRow } from "./session-options";
import { Text, TextInput } from "./text";
import { useTheme } from "./theme";

type Directory = { name: string; path: string; isGitRepo?: boolean; isEmpty?: boolean };
type Listing = { current: string; parent: string | null; directories: Directory[] };

export function FolderRailSheet({
  visible,
  onClose,
  folders,
  setOrder,
  setHidden,
  addFolder,
  createFolder,
  projectsRoot,
}: {
  visible: boolean;
  onClose: () => void;
  folders: FolderRow[];
  setOrder: (cwds: string[]) => void;
  setHidden: (cwd: string, hidden: boolean) => void;
  addFolder: (path: string) => Promise<void>;
  createFolder: (name: string) => Promise<string>;
  projectsRoot: string | null;
}) {
  const { colors, type, space, radius } = useTheme();
  const [mode, setMode] = useState<"list" | "browse" | "create">("list");
  useEffect(() => {
    if (!visible) setMode("list");
  }, [visible]);

  return (
    <Sheet visible={visible} onClose={onClose}>
            <View style={{ paddingBottom: space.lg, gap: space.md }}>
              {mode === "list" ? (
                <FolderList
                  folders={folders}
                  setOrder={setOrder}
                  setHidden={setHidden}
                  onBrowse={() => setMode("browse")}
                  onCreate={() => setMode("create")}
                />
              ) : mode === "browse" ? (
                <Browser
                  onBack={() => setMode("list")}
                  onPick={async (path) => {
                    await addFolder(path);
                    onClose();
                  }}
                />
              ) : (
                <Create
                  projectsRoot={projectsRoot}
                  onBack={() => setMode("list")}
                  onCreate={async (name) => {
                    await createFolder(name);
                    onClose();
                  }}
                />
              )}
            </View>
    </Sheet>
  );
}

function Heading({ children, onBack }: { children: string; onBack?: () => void }) {
  const { colors, type, space } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg }}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Icon ios="chevron.left" android="chevron_left" size={14} color={colors.textSecondary} />
        </Pressable>
      ) : null}
      <Text style={{ ...type.headline, color: colors.text }}>{children}</Text>
    </View>
  );
}

const ROW_H = 46;
const LAYOUT = LinearTransition.duration(150).easing(Easing.out(Easing.quad));

/**
 * DRAG TO REORDER. Grab the handle at the end of a row and slide; the other
 * rows step out of the way as the finger crosses their midlines, and the
 * order is written when the finger lifts. Rows are a fixed height, so the
 * target slot is arithmetic on the drag distance, not measurement.
 */
function FolderList({
  folders,
  setOrder,
  setHidden,
  onBrowse,
  onCreate,
}: {
  folders: FolderRow[];
  setOrder: (cwds: string[]) => void;
  setHidden: (cwd: string, hidden: boolean) => void;
  onBrowse: () => void;
  onCreate: () => void;
}) {
  const { colors, type, space, radius } = useTheme();
  const byCwd = useMemo(() => new Map(folders.map((f) => [f.cwd, f] as const)), [folders]);
  const [order, setLocalOrder] = useState(() => folders.map((f) => f.cwd));
  const [drag, setDrag] = useState<{ cwd: string; from: number; dy: number } | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const setOrderRef = useRef(setOrder);
  setOrderRef.current = setOrder;

  // Follow the picker's list while nothing is being dragged.
  useEffect(() => {
    if (!dragRef.current) setLocalOrder(folders.map((f) => f.cwd));
  }, [folders]);

  /**
   * Raw touch events, not the responder system. The list's ScrollView wins
   * the responder negotiation on the first vertical move, which is why a
   * PanResponder on the handle never saw a grant; touch events still reach
   * the deepest view regardless of who the responder is, and the ScrollView
   * is frozen (`scrollEnabled={!drag}`) for the duration.
   */
  const startY = useRef(0);
  const handleFor = (cwd: string) => ({
    onTouchStart: (e: GestureResponderEvent) => {
      startY.current = e.nativeEvent.pageY;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setDrag({ cwd, from: orderRef.current.indexOf(cwd), dy: 0 });
    },
    onTouchMove: (e: GestureResponderEvent) => {
      const d = dragRef.current;
      if (!d || d.cwd !== cwd) return;
      const dy = e.nativeEvent.pageY - startY.current;
      const list = orderRef.current;
      const cur = list.indexOf(cwd);
      const target = Math.min(list.length - 1, Math.max(0, Math.round(d.from + dy / ROW_H)));
      if (target !== cur) {
        const next = list.filter((c) => c !== cwd);
        next.splice(target, 0, cwd);
        setLocalOrder(next);
        void Haptics.selectionAsync();
      }
      setDrag({ ...d, dy });
    },
    onTouchEnd: () => {
      if (dragRef.current?.cwd !== cwd) return;
      setOrderRef.current(orderRef.current);
      setDrag(null);
    },
    onTouchCancel: () => {
      if (dragRef.current?.cwd !== cwd) return;
      setOrderRef.current(orderRef.current);
      setDrag(null);
    },
  });

  const rows = order.map((cwd) => byCwd.get(cwd)).filter((f): f is FolderRow => !!f);
  return (
    <>
      <Heading>Folders</Heading>
      <ScrollView
        bounces={false}
        scrollEnabled={!drag}
        style={{ maxHeight: 360 }}
        contentContainerStyle={{ paddingHorizontal: space.lg }}
      >
        <View style={{ borderRadius: radius.xl, backgroundColor: colors.card, overflow: "visible" }}>
          {rows.map((folder, index) => {
            const dragging = drag?.cwd === folder.cwd;
            // The dragged row is drawn where the finger is: its slot has
            // already moved with the order, so the finger offset is corrected
            // by however many slots it has crossed.
            const lift = dragging && drag ? drag.dy - (index - drag.from) * ROW_H : 0;
            return (
              <Reanimated.View
                key={folder.cwd}
                layout={dragging ? undefined : LAYOUT}
                style={{ zIndex: dragging ? 10 : 0 }}
              >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  height: ROW_H,
                  paddingLeft: space.lg,
                  paddingRight: space.xs,
                  gap: space.xs,
                  borderTopWidth: index === 0 || dragging ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: colors.borderSoft,
                  borderRadius: dragging ? radius.md : 0,
                  backgroundColor: dragging ? colors.popover : "transparent",
                  opacity: folder.hidden && !dragging ? 0.5 : 1,
                  transform: [{ translateY: lift }, { scale: dragging ? 1.02 : 1 }],
                  shadowColor: "#000",
                  shadowOpacity: dragging ? 0.25 : 0,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 6 },
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{ ...type.body, flex: 1, color: colors.text, fontWeight: folder.selected ? "600" : "400" }}
                >
                  {folder.label}
                </Text>
                <RowButton
                  label={folder.hidden ? `Add ${folder.label} to the rail` : `Remove ${folder.label} from the rail`}
                  ios={folder.hidden ? "plus.circle" : "minus.circle"}
                  android={folder.hidden ? "add_circle" : "remove_circle"}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setHidden(folder.cwd, !folder.hidden);
                  }}
                />
                <View
                  {...handleFor(folder.cwd)}
                  accessibilityRole="adjustable"
                  accessibilityLabel={`Reorder ${folder.label}`}
                  accessibilityHint="Drag up or down"
                  style={{ width: 40, height: ROW_H, alignItems: "center", justifyContent: "center" }}
                >
                  <Icon ios="line.3.horizontal" android="drag_handle" size={16} color={colors.textMuted} />
                </View>
              </View>
              </Reanimated.View>
            );
          })}
        </View>
      </ScrollView>
      <View style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg }}>
        <ActionButton label="Add folder…" ios="folder.badge.plus" android="create_new_folder" onPress={onBrowse} />
        <ActionButton label="New folder…" ios="plus" android="add" onPress={onCreate} />
      </View>
    </>
  );
}

function RowButton({
  label,
  ios,
  android,
  disabled,
  onPress,
}: {
  label: string;
  ios: SFSymbol;
  android: AndroidSymbol;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({
        width: 34,
        height: 34,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.25 : pressed ? 0.5 : 1,
      })}
    >
      <Icon ios={ios} android={android} size={16} color={colors.textSecondary} />
    </Pressable>
  );
}

function ActionButton({
  label,
  ios,
  android,
  onPress,
}: {
  label: string;
  ios: SFSymbol;
  android: AndroidSymbol;
  onPress: () => void;
}) {
  const { colors, type, radius } = useTheme();
  // The flex lives on a plain View: PressableScale hands `style` to its
  // animated inner node, where `flex: 1` has no row to grow in.
  return (
    <View style={{ flex: 1 }}>
      <PressableScale
        onPress={onPress}
        scale={0.97}
        accessibilityRole="button"
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingVertical: 11,
          borderRadius: radius.lg,
          backgroundColor: colors.card,
        }}
      >
        <Icon ios={ios} android={android} size={14} color={colors.text} />
        <Text style={{ ...type.subhead, fontWeight: "600", color: colors.text }}>{label}</Text>
      </PressableScale>
    </View>
  );
}

/** A directory browser over the machine's home, the way the web's project sheet browses. */
function Browser({ onBack, onPick }: { onBack: () => void; onPick: (path: string) => Promise<void> }) {
  const { client } = useOmg();
  const { colors, type, space, radius } = useTheme();
  const [path, setPath] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setListing(null);
    setError(null);
    client.transport
      .request<Listing>(`/api/filesystem/directories${path ? `?path=${encodeURIComponent(path)}` : ""}`)
      .then((res) => {
        if (!cancelled) setListing(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [client, path]);

  return (
    <>
      <Heading onBack={onBack}>Add folder</Heading>
      <Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted, paddingHorizontal: space.lg }}>
        {listing?.current ?? path ?? "Home"}
      </Text>
      <ScrollView bounces={false} style={{ maxHeight: 320 }} contentContainerStyle={{ paddingHorizontal: space.lg }}>
        <View style={{ borderRadius: radius.xl, backgroundColor: colors.card, overflow: "hidden" }}>
          {listing?.parent ? (
            <Pressable
              onPress={() => setPath(listing.parent)}
              accessibilityRole="button"
              style={({ pressed }) => ({ paddingHorizontal: space.lg, minHeight: 44, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={{ ...type.body, color: colors.textSecondary }}>..</Text>
            </Pressable>
          ) : null}
          {!listing && !error ? <ActivityIndicator color={colors.textMuted} style={{ padding: space.md }} /> : null}
          {error ? <Text style={{ ...type.footnote, color: colors.danger, padding: space.md }}>{error}</Text> : null}
          {listing?.directories.map((dir) => (
            <Pressable
              key={dir.path}
              onPress={() => setPath(dir.path)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingHorizontal: space.lg,
                minHeight: 44,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: colors.borderSoft,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Icon ios="folder" android="folder" size={14} color={colors.textMuted} />
              <Text numberOfLines={1} style={{ ...type.body, color: colors.text, flex: 1 }}>{dir.name}</Text>
              {dir.isGitRepo ? <Text style={{ ...type.caption, color: colors.textMuted }}>git</Text> : null}
              <Icon ios="chevron.right" android="chevron_right" size={11} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: space.lg }}>
        <PressableScale
          onPress={() => {
            const target = listing?.current ?? path;
            if (!target || busy) return;
            setBusy(true);
            onPick(target)
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          }}
          scale={0.98}
          disabled={!listing || busy}
          accessibilityRole="button"
          style={{ alignItems: "center", paddingVertical: 12, borderRadius: radius.lg, backgroundColor: colors.text, opacity: listing ? 1 : 0.5 }}
        >
          {busy ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={{ ...type.headline, color: colors.bg }}>Use this folder</Text>
          )}
        </PressableScale>
      </View>
    </>
  );
}

function Create({
  projectsRoot,
  onBack,
  onCreate,
}: {
  projectsRoot: string | null;
  onBack: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const { colors, type, space, radius } = useTheme();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clean = name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (
    <>
      <Heading onBack={onBack}>New folder</Heading>
      <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Project name"
          placeholderTextColor={colors.textMuted}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          style={{ ...type.body, color: colors.text, backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: 10 }}
        />
        <Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>
          {projectsRoot ? `${projectsRoot}/${clean || "…"}` : "This machine has no projects folder yet"}
        </Text>
        {error ? <Text style={{ ...type.footnote, color: colors.danger }}>{error}</Text> : null}
        <PressableScale
          onPress={() => {
            if (!clean || busy) return;
            setBusy(true);
            onCreate(clean)
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          }}
          scale={0.98}
          disabled={!clean || !projectsRoot || busy}
          accessibilityRole="button"
          style={{ alignItems: "center", paddingVertical: 12, borderRadius: radius.lg, backgroundColor: colors.text, opacity: clean && projectsRoot ? 1 : 0.5 }}
        >
          {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={{ ...type.headline, color: colors.bg }}>Create and add</Text>}
        </PressableScale>
      </View>
    </>
  );
}
