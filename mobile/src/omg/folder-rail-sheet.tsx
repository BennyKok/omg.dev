/**
 * THE FOLDER RAIL, ARRANGED. Long-press a pill on Live and this card lists
 * every folder the machine has: move one up or down, take it off the rail or
 * put it back, add an existing folder from the machine, or make a new one.
 * Order and hidden set live on the device (see STORAGE_KEYS.folderRail).
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Reanimated, { Easing, FadeIn, FadeInDown, FadeOut, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import type { AndroidSymbol, SFSymbol } from "expo-symbols";

import { Icon } from "../components";
import { GlassSurface } from "./glass";
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
  move,
  setHidden,
  addFolder,
  createFolder,
  projectsRoot,
}: {
  visible: boolean;
  onClose: () => void;
  folders: FolderRow[];
  move: (cwd: string, delta: -1 | 1) => void;
  setHidden: (cwd: string, hidden: boolean) => void;
  addFolder: (path: string) => Promise<void>;
  createFolder: (name: string) => Promise<string>;
  projectsRoot: string | null;
}) {
  const { colors, type, space, radius, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<"list" | "browse" | "create">("list");
  useEffect(() => {
    if (!visible) setMode("list");
  }, [visible]);
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Reanimated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(120)} style={StyleSheet.absoluteFill}>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={{ flex: 1, backgroundColor: isDark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.25)" }}
          />
        </Reanimated.View>
        <Reanimated.View
          entering={FadeInDown.duration(170).easing(Easing.out(Easing.cubic))}
          exiting={FadeOutDown.duration(130)}
          style={{ marginHorizontal: 10, marginBottom: Math.max(insets.bottom, 10), maxWidth: 560, alignSelf: "center", width: "100%" }}
        >
          <GlassSurface variant="regular" fallbackColor={colors.popover} style={{ borderRadius: 30, overflow: "hidden" }}>
            <View style={{ paddingTop: 8, paddingBottom: space.lg, gap: space.md }}>
              <View style={{ alignSelf: "center", width: 36, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong }} />
              {mode === "list" ? (
                <FolderList
                  folders={folders}
                  move={move}
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
          </GlassSurface>
        </Reanimated.View>
      </View>
    </Modal>
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

function FolderList({
  folders,
  move,
  setHidden,
  onBrowse,
  onCreate,
}: {
  folders: FolderRow[];
  move: (cwd: string, delta: -1 | 1) => void;
  setHidden: (cwd: string, hidden: boolean) => void;
  onBrowse: () => void;
  onCreate: () => void;
}) {
  const { colors, type, space, radius } = useTheme();
  const tap = () => void Haptics.selectionAsync();
  return (
    <>
      <Heading>Folders</Heading>
      <ScrollView bounces={false} style={{ maxHeight: 360 }} contentContainerStyle={{ paddingHorizontal: space.lg }}>
        <View style={{ borderRadius: radius.xl, backgroundColor: colors.card, overflow: "hidden" }}>
          {folders.map((folder, index) => (
            <View
              key={folder.cwd}
              style={{
                flexDirection: "row",
                alignItems: "center",
                minHeight: 46,
                paddingLeft: space.lg,
                paddingRight: space.sm,
                gap: space.sm,
                borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: colors.borderSoft,
                opacity: folder.hidden ? 0.5 : 1,
              }}
            >
              <Text numberOfLines={1} style={{ ...type.body, flex: 1, color: colors.text, fontWeight: folder.selected ? "600" : "400" }}>
                {folder.label}
              </Text>
              <RowButton
                label={`Move ${folder.label} up`}
                ios="chevron.up"
                android="expand_less"
                disabled={index === 0}
                onPress={() => {
                  tap();
                  move(folder.cwd, -1);
                }}
              />
              <RowButton
                label={`Move ${folder.label} down`}
                ios="chevron.down"
                android="expand_more"
                disabled={index === folders.length - 1}
                onPress={() => {
                  tap();
                  move(folder.cwd, 1);
                }}
              />
              <RowButton
                label={folder.hidden ? `Add ${folder.label} to the rail` : `Remove ${folder.label} from the rail`}
                ios={folder.hidden ? "plus.circle" : "minus.circle"}
                android={folder.hidden ? "add_circle" : "remove_circle"}
                onPress={() => {
                  tap();
                  setHidden(folder.cwd, !folder.hidden);
                }}
              />
            </View>
          ))}
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
