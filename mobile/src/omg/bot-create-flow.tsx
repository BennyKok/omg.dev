/**
 * New Bot — a full-page, onboarding-style flow. Replaces the bottom sheet
 * this used to be (bot-edit-sheet.tsx + bottom-sheet.tsx, both deleted with
 * this change — see the PR description for why nothing else used either).
 *
 * Benny's brief, verbatim: "The create bot flow on ios needs to be full
 * page, and clean, it will be like onboarding." Read literally: generous
 * spacing, one decision at a time, a clear sense of progress, and the
 * avatar — shape x colorway, the moment a bot stops being a config row and
 * becomes somebody — as the thing most worth spending the space on.
 *
 * FOUR STEPS, NOT THE SHEET'S ONE SCREEN: avatar -> name -> persona ->
 * agent/folder + create. Avatar goes first and alone because it is the hero;
 * making someone type a name before they have even chosen a face buries the
 * one moment this whole rebuild exists to give room to. Name and persona
 * each get their own screen because they are the two places someone actually
 * writes something, and writing wants to be the only thing on screen. Agent
 * and folder close it out together — both are "where does this run," one
 * decision in two parts, not two more decisions to sit through solo — and
 * that is also where Create lives, so the review and the ask are the same
 * tap.
 *
 * EDIT IS A DIFFERENT SCREEN (bot-edit-screen.tsx), NOT THIS ONE WITH A
 * FLAG. A wizard is a first-run shape; walking Avatar -> Name -> Persona ->
 * Setup to fix a typo in a persona is worse than the sheet it replaces. The
 * two screens share their field-level pieces (bot-fields.tsx) so the visual
 * language matches exactly; only the screen-level shape differs.
 *
 * BACK IS OURS TO OWN. The interactive swipe-back gesture is switched off
 * for this route (see app/_layout.tsx) so it cannot silently exit the whole
 * flow from step 3 while the header's own back chevron only steps back one
 * — two controls disagreeing about what "back" means on the same screen is
 * worse than only offering one. The chevron and the Android hardware back
 * button both do the same thing: step back, or leave on step one, and
 * nothing already typed is lost either way, because every field lives in
 * this one component's state for the life of the flow, not per-step state
 * that would be discarded on a re-mount.
 */

import { useEffect, useState } from "react";
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";

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

const STEPS = ["avatar", "name", "persona", "setup"] as const;
type StepId = (typeof STEPS)[number];

export function BotCreateFlow() {
  const router = useRouter();
  const { colors, space } = useTheme();
  const { client, user, agents, repos } = useOmg();
  const toast = useToast();

  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [shape, setShape] = useState<BotShape>("circle");
  const [colorway, setColorway] = useState<BotColorway>("warm");
  const [agent, setAgent] = useState("aisdk");
  const [cwd, setCwd] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const step: StepId = STEPS[stepIndex];
  const isLastStep = stepIndex === STEPS.length - 1;
  const nameValid = name.trim().length > 0;
  const personaValid = persona.trim().length > 0;
  const canCreate = nameValid && personaValid && !saving;

  const exitFlow = () => router.back();
  const goBack = () => {
    if (stepIndex === 0) exitFlow();
    else setStepIndex((i) => i - 1);
  };
  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));

  // Android hardware back mirrors the header chevron: step back, or fall
  // through to the default pop on step one.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stepIndex === 0) return false;
      setStepIndex((i) => i - 1);
      return true;
    });
    return () => sub.remove();
  }, [stepIndex]);

  const create = async () => {
    if (!client || !canCreate) return;
    setSaving(true);
    try {
      const res = await client.transport.request<{ bot?: Bot }>("/api/bots", {
        method: "POST",
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
      toast.show(`${res.bot.name} joined the roster.`);
      router.back();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Could not create bot");
    } finally {
      setSaving(false);
    }
  };

  const primaryDisabled = step === "name" ? !nameValid : step === "persona" ? !personaValid : step === "setup" ? !canCreate : false;
  const primaryLabel = isLastStep ? "Create bot" : "Continue";
  const onPrimary = () => (isLastStep ? void create() : goNext());

  const agentOptions = buildAgentOptions(agents, agent, setAgent);
  const repoOptions = buildRepoOptions(repos, cwd, setCwd);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlowHeader onBack={goBack} progress={{ total: STEPS.length, current: stepIndex }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xl }}
          keyboardShouldPersistTaps="handled"
        >
          {step === "avatar" ? (
            <>
              <StepHeading title="Give your bot a face" subtitle="Pick a shape and a color. You can change this any time." />
              <AvatarHero shape={shape} colorway={colorway} />
              <View style={{ marginTop: space.xl }}>
                <FieldLabel>Shape</FieldLabel>
                <ShapePicker shape={shape} colorway={colorway} onChange={setShape} />
              </View>
              <View style={{ marginTop: space.xl }}>
                <FieldLabel>Colorway</FieldLabel>
                <ColorwayPicker colorway={colorway} onChange={setColorway} />
              </View>
            </>
          ) : null}

          {step === "name" ? (
            <>
              <StepHeading title="What should we call it?" subtitle="This is how it shows up on your roster." />
              <AvatarHero shape={shape} colorway={colorway} />
              <View style={{ marginTop: space.xl }}>
                <NameField value={name} onChange={setName} autoFocus />
              </View>
            </>
          ) : null}

          {step === "persona" ? (
            <>
              <StepHeading
                title={`How should ${name.trim() || "it"} think and talk?`}
                subtitle="A few sentences is plenty — tone, focus, anything it should never do."
              />
              <PersonaField value={persona} onChange={setPersona} autoFocus />
            </>
          ) : null}

          {step === "setup" ? (
            <>
              <StepHeading title="Almost there" subtitle={`${name.trim() || "Your bot"} is ready for an agent and a folder.`} />
              <FieldLabel>Agent</FieldLabel>
              <DropdownMenu options={agentOptions} style={{ marginBottom: space.lg }}>
                <PickerField label="Agent" value={agentDisplayLabel(agents, agent)} ios="cpu" android="memory" />
              </DropdownMenu>
              <FieldLabel>Folder</FieldLabel>
              <DropdownMenu options={repoOptions}>
                <PickerField label="Folder" value={repoDisplayLabel(repos, cwd)} ios="folder" android="folder" />
              </DropdownMenu>
            </>
          ) : null}
        </ScrollView>

        <FlowFooter>
          <PrimaryButton label={primaryLabel} onPress={onPrimary} disabled={primaryDisabled} loading={isLastStep && saving} />
        </FlowFooter>
      </KeyboardAvoidingView>
    </View>
  );
}
