/**
 * Steps 01 to 03 as one flow, before sign-in.
 *
 * ── Why this owns the draft ───────────────────────────────────────────────
 *
 * Signing in re-mounts everything below it: `authStatus` flips, _layout.tsx
 * swaps which Stack is registered, and any state living inside those screens
 * is gone. A prompt somebody just wrote is the one thing in this flow that
 * cannot be recreated, so it is held HERE, above that boundary, and handed
 * down. Dismissing the drawer returns to the same words because the words were
 * never in the drawer's tree.
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
import { SignInDrawer, type SignInMethod } from "./onboarding-signin-drawer";
import { TaskScreen } from "./onboarding-task";
import { WelcomeScreen } from "./onboarding-welcome";
import { filePickerOptions } from "./file-picker";
import { promptFor, type InterestKey } from "./onboarding-tasks";
import type { PickedFile } from "./attachments";
import { useTheme } from "./theme";

type Step = "welcome" | "interests" | "task" | "prompt";

export type OnboardingChoice = {
  interest: InterestKey | null;
  taskId: string | null;
  /** What the person actually wants run, edited or written from scratch. */
  prompt: string;
  /** Local URIs. Nothing has been uploaded; there is nowhere to put them yet. */
  files: PickedFile[];
};

export function OnboardingFlow({
  onSignIn,
  onStash,
  onTerms,
  onPrivacy,
  signedIn = false,
}: {
  /**
   * Hand the finished choice up; the caller opens the real sign-in. `method`
   * is null when there was no drawer -- see `signedIn`.
   */
  onSignIn: (choice: OnboardingChoice, method: SignInMethod | null) => void;
  /**
   * Save the choice without leaving the flow. Apple and Google authenticate
   * inside the drawer, so the prompt has to be stored while this tree is still
   * mounted, and the caller must NOT complete the intro -- doing so replaces
   * the drawer mid sign-in.
   */
  onStash: (choice: OnboardingChoice) => Promise<void>;
  onTerms: () => void;
  onPrivacy: () => void;
  /**
   * The person already has an account.
   *
   * One fact, two honest consequences: the last button reads "Continue"
   * instead of "Sign in to start", and there is no drawer, because asking
   * somebody to sign in while they are signed in is a dead end. This is what
   * app/onboarding.tsx uses to REPLAY the flow from Settings.
   */
  signedIn?: boolean;
}) {
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>("welcome");
  const [interest, setInterest] = useState<InterestKey | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [custom, setCustom] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /*
   * Picked, not uploaded. There is no account and no Computer on this side of
   * the flow, so the files ride across sign-in as local URIs and are sent by
   * onboarding-launch.ts once there is somewhere to send them.
   */
  const [files, setFiles] = useState<PickedFile[]>([]);
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
          onBack={() => setStep("welcome")}
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
          finalLabel={signedIn ? "Continue" : undefined}
          onSignIn={() =>
            signedIn
              ? onSignIn({ interest, taskId, prompt: prompt.trim(), files }, null)
              : setDrawerOpen(true)
          }
          onBack={() => setStep("task")}
        />
      ) : null}

      <SignInDrawer
        visible={drawerOpen && !signedIn}
        // "Not yet", not "start over": the prompt is untouched because it was
        // never inside this drawer.
        onClose={() => setDrawerOpen(false)}
        /*
         * Email only. Apple and Google finish inside the drawer, so the only
         * method that still needs another screen is the one with a field on
         * it. See the drawer's header.
         */
        onChoose={(method) => {
          setDrawerOpen(false);
          onSignIn({ interest, taskId, prompt: prompt.trim(), files }, method);
        }}
        /*
         * Saved before the drawer leaves the app to authenticate, because
         * Apple and Google both hand off to something that can outlive this
         * process. The caller stashes; it must not complete the intro here,
         * which would swap this tree out from under an in-flight sign-in.
         */
        onBeforeAuthenticate={() => onStash({ interest, taskId, prompt: prompt.trim(), files })}
        onTerms={onTerms}
        onPrivacy={onPrivacy}
      />
    </View>
  );
}
