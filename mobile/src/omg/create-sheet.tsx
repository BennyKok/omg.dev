/**
 * THE "+" PILL: start something new with a preset.
 *
 * Four kinds, one card. Pick what to make, say where (a new project folder
 * beside the others, or an existing one), read or edit the preset prompt,
 * Start. Websites, slides and images go through the artifacts the agent can
 * already publish; the iOS app preset points the agent at Expo and the
 * omg.dev backend docs. The card only assembles a prompt and a folder; the
 * session itself starts through the same request the composer uses.
 */
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";

import * as Haptics from "expo-haptics";
import type { AndroidSymbol, SFSymbol } from "expo-symbols";

import { Icon } from "../components";
import { Sheet } from "./sheet";
import { PressableScale } from "./motion";
import type { FolderRow } from "./session-options";
import { Text, TextInput } from "./text";
import { useTheme } from "./theme";

export type CreateKind = "ios" | "website" | "slides" | "image";

const KINDS: Array<{ kind: CreateKind; title: string; blurb: string; ios: SFSymbol; android: AndroidSymbol }> = [
  { kind: "ios", title: "iOS app", blurb: "Expo, with omg.dev as the backend", ios: "iphone", android: "smartphone" },
  { kind: "website", title: "Website", blurb: "One HTML file, published as an artifact", ios: "globe", android: "language" },
  { kind: "slides", title: "Slides", blurb: "An HTML deck, published as an artifact", ios: "rectangle.on.rectangle", android: "slideshow" },
  { kind: "image", title: "Image", blurb: "Made and shown in the chat", ios: "photo", android: "image" },
];

/**
 * DRAFT PRESETS. Plain instructions the agent can act on; the "{describe}"
 * line is where the person's own words go, and the card puts the caret
 * there. Edit freely; nothing else reads these.
 */
export const CREATE_PRESETS: Record<CreateKind, string> = {
  ios: [
    "Build an iOS app with Expo (managed workflow, expo-router, TypeScript).",
    "Use omg.dev as the backend: read https://docs.omg.dev first and follow its API and auth contracts for sign-in, sessions and data.",
    "Set the project up so `npx expo start` runs, then build the first screen.",
    "Ask me before adding any native module.",
    "",
    "The app: {describe}",
  ].join("\n"),
  website: [
    "Build a website as a single self-contained HTML file (inline CSS and JS, no build step), responsive on phone and desktop.",
    "Publish it with omg_publish_artifact so I can open it here, and refresh the same artifact when you change it.",
    "",
    "The site: {describe}",
  ].join("\n"),
  slides: [
    "Create a slide deck as a single self-contained HTML file: one <section> per slide, 16:9, arrow keys and tap to advance, large readable type.",
    "Publish it with omg_publish_artifact so I can open it here, and refresh the same artifact when you change it.",
    "",
    "The talk: {describe}",
  ].join("\n"),
  image: [
    "Create an image, save the file in the project, and show it to me with omg_display_image.",
    "",
    "The image: {describe}",
  ].join("\n"),
};

export function CreateSheet({
  visible,
  onClose,
  folders,
  projectsRoot,
  createFolder,
  launch,
}: {
  visible: boolean;
  onClose: () => void;
  /** The machine's folders in rail order; hidden ones are still valid targets. */
  folders: FolderRow[];
  projectsRoot: string | null;
  createFolder: (name: string) => Promise<string>;
  /** Starts the session the way the composer does, with an explicit folder. */
  launch: (args: { prompt: string; cwd: string }) => Promise<void>;
}) {
  const { colors, type, space, radius } = useTheme();
  const [kind, setKind] = useState<CreateKind>("ios");
  const [where, setWhere] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(CREATE_PRESETS.ios);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) return;
    setKind("ios");
    setWhere("new");
    setName("");
    setCwd(null);
    setPrompt(CREATE_PRESETS.ios);
    setTouched(false);
    setBusy(false);
    setError(null);
  }, [visible]);

  // A fresh kind brings its preset, unless the person has already written.
  const pickKind = (next: CreateKind) => {
    void Haptics.selectionAsync();
    setKind(next);
    if (!touched) setPrompt(CREATE_PRESETS[next]);
  };

  const cleanName = name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const existing = useMemo(() => folders.filter((f) => !f.hidden), [folders]);
  const target = where === "existing" ? (cwd ?? existing.find((f) => f.selected)?.cwd ?? existing[0]?.cwd ?? null) : null;
  const ready =
    !busy &&
    prompt.trim().length > 0 &&
    !prompt.includes("{describe}") &&
    (where === "new" ? !!cleanName && !!projectsRoot : !!target);

  const start = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const folder = where === "new" ? await createFolder(cleanName) : target!;
      await launch({ prompt: prompt.trim(), cwd: folder });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 640 }}
              contentContainerStyle={{ paddingBottom: space.lg, gap: space.md }}
            >
              <Text style={{ ...type.headline, color: colors.text, paddingHorizontal: space.lg }}>Create</Text>

              {/* WHAT */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.lg }}>
                {KINDS.map((k) => {
                  const on = k.kind === kind;
                  return (
                    <View key={k.kind} style={{ width: "48%", flexGrow: 1 }}>
                      <PressableScale
                        onPress={() => pickKind(k.kind)}
                        scale={0.97}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={{
                          padding: space.md,
                          gap: 4,
                          borderRadius: radius.xl,
                          backgroundColor: on ? colors.text : colors.card,
                        }}
                      >
                        <Icon ios={k.ios} android={k.android} size={18} color={on ? colors.bg : colors.text} />
                        <Text style={{ ...type.subhead, fontWeight: "600", color: on ? colors.bg : colors.text }}>{k.title}</Text>
                        <Text numberOfLines={2} style={{ ...type.caption, color: on ? colors.bg : colors.textMuted }}>{k.blurb}</Text>
                      </PressableScale>
                    </View>
                  );
                })}
              </View>

              {/* WHERE */}
              <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
                <View style={{ flexDirection: "row", backgroundColor: colors.card, borderRadius: radius.lg, padding: 3 }}>
                  {(["new", "existing"] as const).map((w) => (
                    <View key={w} style={{ flex: 1 }}>
                      <PressableScale
                        onPress={() => {
                          void Haptics.selectionAsync();
                          setWhere(w);
                        }}
                        scale={0.97}
                        accessibilityRole="button"
                        accessibilityState={{ selected: where === w }}
                        style={{
                          paddingVertical: 7,
                          alignItems: "center",
                          borderRadius: radius.md,
                          backgroundColor: where === w ? colors.text : "transparent",
                        }}
                      >
                        <Text style={{ ...type.footnote, fontWeight: "600", color: where === w ? colors.bg : colors.textSecondary }}>
                          {w === "new" ? "New project" : "Existing folder"}
                        </Text>
                      </PressableScale>
                    </View>
                  ))}
                </View>
                {where === "new" ? (
                  <>
                    <TextInput
                      value={name}
                      onChangeText={setName}
                      placeholder="Project name"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={{ ...type.body, color: colors.text, backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: 10 }}
                    />
                    <Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>
                      {projectsRoot ? `${projectsRoot}/${cleanName || "…"}` : "This machine has no projects folder yet"}
                    </Text>
                  </>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
                    {existing.map((f) => {
                      const on = f.cwd === target;
                      return (
                        <PressableScale
                          key={f.cwd}
                          onPress={() => {
                            void Haptics.selectionAsync();
                            setCwd(f.cwd);
                          }}
                          scale={0.96}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          style={{
                            minHeight: 34,
                            justifyContent: "center",
                            paddingHorizontal: 14,
                            borderRadius: radius.pill,
                            borderWidth: 1,
                            borderColor: on ? colors.borderStrong : "transparent",
                            backgroundColor: on ? colors.card : colors.secondary,
                          }}
                        >
                          <Text style={{ ...type.footnote, fontWeight: "600", color: on ? colors.text : colors.textSecondary }}>{f.label}</Text>
                        </PressableScale>
                      );
                    })}
                  </ScrollView>
                )}
              </View>

              {/* THE PROMPT */}
              <View style={{ paddingHorizontal: space.lg, gap: 6 }}>
                <Text style={{ ...type.caption, color: colors.textMuted }}>Prompt</Text>
                <TextInput
                  value={prompt}
                  onChangeText={(t) => {
                    setTouched(true);
                    setPrompt(t);
                  }}
                  multiline
                  scrollEnabled={false}
                  style={{
                    ...type.callout,
                    lineHeight: 21,
                    color: colors.text,
                    backgroundColor: colors.card,
                    borderRadius: radius.lg,
                    paddingHorizontal: space.md,
                    paddingVertical: 10,
                    minHeight: 120,
                  }}
                />
                {prompt.includes("{describe}") ? (
                  <Text style={{ ...type.caption, color: colors.textMuted }}>Replace {"{describe}"} with what you want.</Text>
                ) : null}
                {error ? <Text style={{ ...type.footnote, color: colors.danger }}>{error}</Text> : null}
              </View>

              <View style={{ paddingHorizontal: space.lg }}>
                <PressableScale
                  onPress={() => void start()}
                  scale={0.98}
                  disabled={!ready}
                  accessibilityRole="button"
                  style={{ alignItems: "center", paddingVertical: 12, borderRadius: radius.lg, backgroundColor: colors.text, opacity: ready ? 1 : 0.5 }}
                >
                  {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={{ ...type.headline, color: colors.bg }}>Start</Text>}
                </PressableScale>
              </View>
            </ScrollView>
    </Sheet>
  );
}
