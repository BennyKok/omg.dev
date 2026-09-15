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
import { useCallback, useState } from "react";
import { View } from "react-native";

import { InterestsScreen } from "./onboarding-interests";
import { PromptScreen } from "./onboarding-prompt";
import { SignInDrawer, type SignInMethod } from "./onboarding-signin-drawer";
import { TaskScreen } from "./onboarding-task";
import { WelcomeScreen } from "./onboarding-welcome";
import { promptFor, type InterestKey } from "./onboarding-tasks";
import { useTheme } from "./theme";

type Step = "welcome" | "interests" | "task" | "prompt";

export type OnboardingChoice = {
  interest: InterestKey | null;
  taskId: string | null;
  /** What the person actually wants run, edited or written from scratch. */
  prompt: string;
};

export function OnboardingFlow({
  onSignIn,
  onTerms,
  onPrivacy,
  onAttach,
}: {
  /** Hand the finished choice up; the caller opens the real sign-in. */
  onSignIn: (choice: OnboardingChoice, method: SignInMethod) => void;
  onTerms: () => void;
  onPrivacy: () => void;
  onAttach: () => void;
}) {
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>("welcome");
  const [interest, setInterest] = useState<InterestKey | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [custom, setCustom] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
          onAttach={onAttach}
          custom={custom}
          onSignIn={() => setDrawerOpen(true)}
          onBack={() => setStep("task")}
        />
      ) : null}

      <SignInDrawer
        visible={drawerOpen}
        // "Not yet", not "start over": the prompt is untouched because it was
        // never inside this drawer.
        onClose={() => setDrawerOpen(false)}
        onChoose={(method) => {
          setDrawerOpen(false);
          onSignIn({ interest, taskId, prompt: prompt.trim() }, method);
        }}
        onTerms={onTerms}
        onPrivacy={onPrivacy}
      />
    </View>
  );
}
