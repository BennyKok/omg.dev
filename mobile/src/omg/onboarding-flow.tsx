/**
 * The onboarding flow, in two halves on either side of sign-in.
 *
 * ── Sign-in comes right after Welcome ─────────────────────────────────────
 *
 * Benny's order, 2026-09-24: Welcome, then sign in, then the questions. The
 * old order asked for a lane, a task and a prompt BEFORE an account existed,
 * so a returning customer on a new phone had to walk three screens of a
 * questionnaire to reach a sign-in button. Now:
 *
 *   - `WelcomeGate` (signed out): the welcome screen, and "Get started" opens
 *     the sign-in drawer. One drawer serves new and existing accounts alike.
 *   - `OnboardingFlow` (signed in): interests, task, prompt. _layout.tsx shows
 *     it only to an account that is not established, so an existing customer
 *     goes straight to the app. A new account's Computer is being set up while
 *     they answer.
 *
 * ── Why one component and not four routes ─────────────────────────────────
 *
 * Same reasoning as onboarding.tsx and ai-consent.tsx: these are gates, not
 * destinations. Routes would be reachable by deep link and would each need a
 * guard to stop a signed-in person landing on them. A local step index cannot
 * be navigated to at all, and back is just `setStep`.
 *
 * Design: "v2_omg.dev iOS onboarding", page "Version 2 · Clean onboarding".
 */
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";

import { InterestsScreen } from "./onboarding-interests";
import { PromptScreen } from "./onboarding-prompt";
import { SignInDrawer } from "./onboarding-signin-drawer";
import { TaskScreen } from "./onboarding-task";
import { WelcomeScreen } from "./onboarding-welcome";
import { filePickerOptions } from "./file-picker";
import { promptFor, type InterestKey } from "./onboarding-tasks";
import type { PickedFile } from "./attachments";
import { useTheme } from "./theme";

/**
 * Before sign-in: Welcome, and the sign-in drawer over it.
 *
 * Apple and Google finish inside the drawer; signing in flips `authStatus` and
 * this whole tree is replaced. Email needs a field and a code, so it hands up
 * and the caller moves to the full sign-in screen.
 */
export function WelcomeGate({
  onEmail,
  onTerms,
  onPrivacy,
}: {
  onEmail: () => void;
  onTerms: () => void;
  onPrivacy: () => void;
}) {
  const { colors } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <WelcomeScreen onStart={() => setDrawerOpen(true)} />
      <SignInDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onChoose={() => {
          setDrawerOpen(false);
          onEmail();
        }}
        onTerms={onTerms}
        onPrivacy={onPrivacy}
      />
    </View>
  );
}

type Step = "welcome" | "interests" | "task" | "prompt";

export type OnboardingChoice = {
  interest: InterestKey | null;
  taskId: string | null;
  /** What the person actually wants run, edited or written from scratch. */
  prompt: string;
  /** Local URIs. Nothing has been uploaded; there is nowhere to put them yet. */
  files: PickedFile[];
};

/**
 * After sign-in: interests, task, prompt. The finished choice goes to `onDone`.
 *
 * `startAt` is "interests" on first run: Welcome was the screen before sign-in
 * and there is no way back to it. The replay from Settings starts at "welcome"
 * so it shows the whole flow.
 */
export function OnboardingFlow({
  onDone,
  finalLabel,
  startAt = "interests",
  initial = null,
}: {
  onDone: (choice: OnboardingChoice) => void;
  /** The prompt screen's last button. */
  finalLabel: string;
  startAt?: "welcome" | "interests";
  /**
   * A choice already made, to reopen on its prompt. Used when "Not now" on the
   * data notice sends a new sign-up back: they return to the words they wrote,
   * not to the first question.
   */
  initial?: OnboardingChoice | null;
}) {
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>(initial ? "prompt" : startAt);
  const [interest, setInterest] = useState<InterestKey | null>(initial?.interest ?? null);
  const [taskId, setTaskId] = useState<string | null>(initial?.taskId ?? null);
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [custom, setCustom] = useState(initial ? !initial.taskId : false);
  /*
   * Picked, not uploaded. The Computer may still be starting while this flow
   * runs, so the files ride in the handoff as local URIs and are sent by
   * onboarding-launch.ts once there is somewhere to send them.
   */
  const [files, setFiles] = useState<PickedFile[]>(initial?.files ?? []);
  const attachOptions = useMemo(
    () =>
      filePickerOptions((picked) =>
        // Same file twice is a mistake, not a request. The URI is the identity
        // because both pickers copy into our cache under a unique name.
        setFiles((current) => [
          ...current,
          ...picked.filter((file) => !current.some((had) => had.uri === file.uri)),
        ]),
      ),
    [],
  );

  /**
   * Choosing a task REPLACES the editor's contents, and going back to change
   * your mind has to replace them again -- otherwise the second task opens
   * showing the first one's prompt. Edits made after this point are the
   * person's and are kept, because nothing calls this again until they pick
   * something different.
   */
  const openTask = useCallback((nextTaskId: string) => {
    setTaskId(nextTaskId);
  }, []);

  const toPrompt = useCallback(() => {
    setCustom(false);
    setPrompt(promptFor(interest, taskId) ?? "");
    setStep("prompt");
  }, [interest, taskId]);

  const toOwnIdea = useCallback(() => {
    setCustom(true);
    setTaskId(null);
    // Blank on purpose: a placeholder, never prefilled text to delete first.
    setPrompt("");
    setStep("prompt");
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {step === "welcome" ? <WelcomeScreen onStart={() => setStep("interests")} /> : null}

      {step === "interests" ? (
        <InterestsScreen
          chosen={interest}
          onChoose={(key) => {
            // A different lane invalidates the task under it; the ids are
            // lane-scoped and one left behind would prefill nothing.
            if (key !== interest) setTaskId(null);
            setInterest(key);
          }}
          onContinue={() => setStep("task")}
          // First run has no screen before this one: Welcome was signed out.
          onBack={startAt === "welcome" ? () => setStep("welcome") : undefined}
        />
      ) : null}

      {step === "task" && interest ? (
        <TaskScreen
          interest={interest}
          chosenTaskId={taskId}
          onChooseTask={openTask}
          onOwnIdea={toOwnIdea}
          onContinue={toPrompt}
          onBack={() => setStep("interests")}
        />
      ) : null}

      {step === "prompt" ? (
        <PromptScreen
          value={prompt}
          onChangeText={setPrompt}
          attachOptions={attachOptions}
          files={files}
          onRemoveFile={(uri) => setFiles((current) => current.filter((f) => f.uri !== uri))}
          custom={custom}
          finalLabel={finalLabel}
          onSignIn={() => onDone({ interest, taskId, prompt: prompt.trim(), files })}
          // The own-idea path can be reached with no lane chosen only by
          // reopening it; back then goes to the lanes, not an empty task list.
          onBack={() => setStep(interest ? "task" : "interests")}
        />
      ) : null}
    </View>
  );
}
