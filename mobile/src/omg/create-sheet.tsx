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
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

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
  /**
   * THREE STEPS, ONE QUESTION EACH. What, where, and what it should be. The
   * single tall card asked all three at once and the preset prose under
   * them made it a wall; now each step fits without scrolling, the preset
   * stays folded behind "Show instructions", and the only thing to type is
   * the description.
   */
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [kind, setKind] = useState<CreateKind>("ios");
  const [where, setWhere] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState<string | null>(null);
  const [describe, setDescribe] = useState("");
  const [instructions, setInstructions] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) return;
    setStep(0);
    setKind("ios");
    setWhere("new");
    setName("");
    setCwd(null);
    setDescribe("");
    setInstructions(null);
    setShowInstructions(false);
    setBusy(false);
    setError(null);
  }, [visible]);

  const preset = instructions ?? CREATE_PRESETS[kind];
  const cleanName = name.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const existing = useMemo(() => folders.filter((f) => !f.hidden), [folders]);
  const target =
    where === "existing" ? (cwd ?? existing.find((f) => f.selected)?.cwd ?? existing[0]?.cwd ?? null) : null;
  const whereReady = where === "new" ? !!cleanName && !!projectsRoot : !!target;
  const ready = !busy && describe.trim().length > 0 && whereReady;

  const kindMeta = KINDS.find((k) => k.kind === kind)!;
  const whereLabel =
    where === "new" ? (cleanName ? `${projectsRoot}/${cleanName}` : "") : (existing.find((f) => f.cwd === target)?.label ?? "");

  const start = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const folder = where === "new" ? await createFolder(cleanName) : target!;
      const prompt = preset.includes("{describe}")
        ? preset.replace("{describe}", describe.trim())
        : `${preset.trim()}\n\n${describe.trim()}`;
      await launch({ prompt, cwd: folder });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const go = (next: 0 | 1 | 2) => {
    void Haptics.selectionAsync();
    setStep(next);
  };

  const button = (label: string, onPress: () => void, enabled = true, loading = false) => (
    <PressableScale
      onPress={onPress}
      scale={0.98}
      disabled={!enabled}
      accessibilityRole="button"
      style={{ alignItems: "center", paddingVertical: 12, borderRadius: radius.lg, backgroundColor: colors.text, opacity: enabled ? 1 : 0.5 }}
    >
      {loading ? <ActivityIndicator color={colors.bg} /> : <Text style={{ ...type.headline, color: colors.bg }}>{label}</Text>}
    </PressableScale>
  );

  return (
    <Sheet visible={visible} onClose={onClose}>
      <ScrollView
        bounces={false}
        keyboardShouldPersistTaps="handled"
        style={{ maxHeight: 560 }}
        contentContainerStyle={{ paddingBottom: space.lg, gap: space.md }}
      >
        {/* Header: back on steps 2 and 3, the question, and where you are. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg }}>
          {step > 0 ? (
            <Pressable onPress={() => go((step - 1) as 0 | 1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
              <Icon ios="chevron.left" android="chevron_left" size={14} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          <Text style={{ ...type.headline, color: colors.text, flex: 1 }}>
            {step === 0 ? "What do you want to make?" : step === 1 ? "Where should it live?" : `Describe the ${kindMeta.title.toLowerCase()}`}
          </Text>
          <Text style={{ ...type.caption, color: colors.textMuted }}>{step + 1} of 3</Text>
        </View>

        {step === 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.lg }}>
            {KINDS.map((k) => (
              <View key={k.kind} style={{ width: "48%", flexGrow: 1 }}>
                <PressableScale
                  onPress={() => {
                    setKind(k.kind);
                    setInstructions(null);
                    go(1);
                  }}
                  scale={0.97}
                  accessibilityRole="button"
                  style={{ padding: space.md, gap: 4, borderRadius: radius.xl, backgroundColor: colors.card, minHeight: 96 }}
                >
                  <Icon ios={k.ios} android={k.android} size={18} color={colors.text} />
                  <Text style={{ ...type.subhead, fontWeight: "600", color: colors.text }}>{k.title}</Text>
                  <Text numberOfLines={2} style={{ ...type.caption, color: colors.textMuted }}>{k.blurb}</Text>
                </PressableScale>
              </View>
            ))}
          </View>
        ) : null}

        {step === 1 ? (
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
                    style={{ paddingVertical: 7, alignItems: "center", borderRadius: radius.md, backgroundColor: where === w ? colors.text : "transparent" }}
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
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => whereReady && go(2)}
                  style={{ ...type.body, color: colors.text, backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: 10 }}
                />
                <Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>
                  {projectsRoot ? `${projectsRoot}/${cleanName || "…"}` : "This machine has no projects folder yet"}
                </Text>
              </>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
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
              </View>
            )}
            {button("Next", () => go(2), whereReady)}
          </View>
        ) : null}

        {step === 2 ? (
          <View style={{ paddingHorizontal: space.lg, gap: space.sm }}>
            <Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>
              {kindMeta.title} · {whereLabel}
            </Text>
            <TextInput
              value={describe}
              onChangeText={setDescribe}
              placeholder={
                kind === "ios"
                  ? "A habit tracker with a weekly view and reminders…"
                  : kind === "website"
                    ? "A landing page for my coffee cart, with a menu and opening hours…"
                    : kind === "slides"
                      ? "Ten slides on why we are moving to Postgres…"
                      : "A flat illustration of a lighthouse at dusk…"
              }
              placeholderTextColor={colors.textMuted}
              autoFocus
              multiline
              scrollEnabled={false}
              style={{ ...type.callout, lineHeight: 21, color: colors.text, backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: 10, minHeight: 96 }}
            />
            <Pressable
              onPress={() => setShowInstructions((v) => !v)}
              accessibilityRole="button"
              style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", paddingVertical: 4 }}
            >
              <Icon ios={showInstructions ? "chevron.down" : "chevron.right"} android={showInstructions ? "expand_more" : "chevron_right"} size={11} color={colors.textMuted} />
              <Text style={{ ...type.caption, color: colors.textMuted }}>{showInstructions ? "Hide instructions" : "Show instructions"}</Text>
            </Pressable>
            {showInstructions ? (
              <TextInput
                value={preset}
                onChangeText={setInstructions}
                multiline
                scrollEnabled={false}
                style={{ ...type.footnote, lineHeight: 18, color: colors.textSecondary, backgroundColor: colors.card, borderRadius: radius.lg, paddingHorizontal: space.md, paddingVertical: 10 }}
              />
            ) : null}
            {error ? <Text style={{ ...type.footnote, color: colors.danger }}>{error}</Text> : null}
            {button("Start", () => void start(), ready, busy)}
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
