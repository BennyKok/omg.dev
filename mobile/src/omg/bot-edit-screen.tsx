/**
 * Edit Bot — full page, same visual language as the create flow
 * (bot-create-flow.tsx), but NOT a wizard.
 *
 * Editing an existing bot is a lookup-and-fix task, not a first run: someone
 * opened this to change one field, most often the persona. Marching them
 * through Avatar -> Name -> Persona -> Setup to fix a typo would be strictly
 * worse than the bottom sheet this whole rebuild exists to replace. So every
 * field is visible and directly reachable in one scroll, grouped into the
 * same three sections the create flow spends four screens on (identity,
 * persona, setup), and the one gate on the footer button is "did anything
 * actually change" rather than "did you finish the wizard."
 *
 * Shares field-level pieces with the create flow (bot-fields.tsx) so the two
 * read as the same product; the screen-level shape is deliberately
 * different — see bot-create-flow.tsx's header for the fuller reasoning.
 *
 * Reached by tapping a roster row (app/bots/index.tsx) — previously that tap
 * opened the same New/Edit sheet in edit mode; now it pushes this screen,
 * same as every other full-page destination in the app.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useNavigation, useRouter } from "expo-router";

import {
  AvatarHero,
  ColorwayPicker,
  FieldLabel,
  FlowFooter,
  FlowHeader,
  NameField,
  PersonaField,
  PickerField,
  ShapePicker,
  StepHeading,
  agentDisplayLabel,
  buildAgentOptions,
  buildRepoOptions,
  repoDisplayLabel,
} from "./bot-fields";
import { PrimaryButton } from "../components";
import { DropdownMenu } from "./menu";
import { useTheme } from "./theme";
import { useToast } from "./toast";
import { useOmg } from "./provider";
import { type Bot, type BotColorway, type BotShape } from "./bots";

export function BotEditScreen({ bot }: { bot: Bot }) {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors, space } = useTheme();
  const { client, user, agents, repos } = useOmg();
  const toast = useToast();

  const [name, setName] = useState(bot.name);
  const [persona, setPersona] = useState(bot.persona);
  const [shape, setShape] = useState<BotShape>(bot.shape ?? "circle");
  const [colorway, setColorway] = useState<BotColorway>(bot.colorway ?? "warm");
  const [agent, setAgent] = useState(bot.agent);
  const [cwd, setCwd] = useState<string | undefined>(bot.cwd);
  const [saving, setSaving] = useState(false);

  // Captured once, from the bot this screen was opened with — not `useState`
  // (which would re-seed on every keystroke) and not read from `bot` on each
  // render (a background roster refetch swapping in a new object reference
  // must not change what "changed" means mid-edit).
  const initial = useRef({
    name: bot.name,
    persona: bot.persona,
    shape: bot.shape ?? "circle",
    colorway: bot.colorway ?? "warm",
    agent: bot.agent,
    cwd: bot.cwd,
  }).current;

  const dirty =
    name !== initial.name ||
    persona !== initial.persona ||
    shape !== initial.shape ||
    colorway !== initial.colorway ||
    agent !== initial.agent ||
    cwd !== initial.cwd;

  const nameValid = name.trim().length > 0;
  const personaValid = persona.trim().length > 0;
  const canSave = dirty && nameValid && personaValid && !saving;

  /**
   * Guards every way this screen can be left — the header's own back button
   * (`router.back()`, dispatched through this same navigator), the iOS
   * interactive swipe-back gesture, and Android's hardware back — with one
   * listener instead of reimplementing "are we leaving" three times.
   *
   * Swipe-back stays ON for this screen (unlike the create wizard, which
   * turns it off — see app/_layout.tsx) because this is an ordinary
   * full-page screen and killing a gesture iOS users reach for reflexively
   * would read as broken. What it must not do is silently drop an edit that
   * was never saved, so a dirty form intercepts the removal and asks first;
   * a clean one lets it through untouched.
   */
  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (e) => {
      if (!dirty) return;
      e.preventDefault();
      Alert.alert("Discard changes?", "Your edits have not been saved.", [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => navigation.dispatch(e.data.action),
        },
      ]);
    });
    return unsubscribe;
  }, [navigation, dirty]);

  const save = async () => {
    if (!client || !canSave) return;
    setSaving(true);
    try {
      const res = await client.transport.request<{ bot?: Bot }>(`/api/bots/${encodeURIComponent(bot.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          persona: persona.trim(),
          shape,
          colorway,
          agent,
          cwd,
          user: user?.email,
        }),
      });
      if (!res?.bot) throw new Error("No bot came back");
      toast.show(`Saved ${res.bot.name}.`);
      router.back();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not save bot");
    } finally {
      setSaving(false);
    }
  };

  const agentOptions = useMemo(() => buildAgentOptions(agents, agent, setAgent), [agents, agent]);
  const repoOptions = useMemo(() => buildRepoOptions(repos, cwd, setCwd), [repos, cwd]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlowHeader onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xl }}
          keyboardShouldPersistTaps="handled"
        >
          <StepHeading title="Edit bot" subtitle="Update its avatar, persona, and setup." />

          <FieldLabel>Identity</FieldLabel>
          <AvatarHero shape={shape} colorway={colorway} />
          <View style={{ marginTop: space.lg }}>
            <ShapePicker shape={shape} colorway={colorway} onChange={setShape} />
          </View>
          <View style={{ marginTop: space.lg }}>
            <ColorwayPicker colorway={colorway} onChange={setColorway} />
          </View>
          <View style={{ marginTop: space.lg }}>
            <NameField value={name} onChange={setName} />
          </View>

          <View style={{ marginTop: space.xxl }}>
            <FieldLabel>Persona</FieldLabel>
            <PersonaField value={persona} onChange={setPersona} />
          </View>

          <View style={{ marginTop: space.xxl }}>
            <FieldLabel>Agent</FieldLabel>
            <DropdownMenu options={agentOptions} style={{ marginBottom: space.lg }}>
              <PickerField label="Agent" value={agentDisplayLabel(agents, agent)} ios="cpu" android="memory" />
            </DropdownMenu>
            <FieldLabel>Folder</FieldLabel>
            <DropdownMenu options={repoOptions}>
              <PickerField label="Folder" value={repoDisplayLabel(repos, cwd)} ios="folder" android="folder" />
            </DropdownMenu>
          </View>
        </ScrollView>

        <FlowFooter>
          <PrimaryButton label="Save changes" onPress={() => void save()} disabled={!canSave} loading={saving} />
        </FlowFooter>
      </KeyboardAvoidingView>
    </View>
  );
}
