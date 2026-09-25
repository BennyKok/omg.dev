/**
 * The onboarding flow, in two halves on either side of sign-in.
 *
 * ── Sign-in comes right after Welcome ─────────────────────────────────────
 *
 * Benny's order, 2026-09-24: Welcome, then sign in, then the first task. The
 * old order asked for a lane, a task and a prompt BEFORE an account existed,
 * so a returning customer on a new phone had to walk three screens of a
 * questionnaire to reach a sign-in button. Now:
 *
 *   - `WelcomeGate` (signed out): the welcome screen, and "Get started" opens
 *     the sign-in drawer. One drawer serves new and existing accounts alike.
 *   - `OnboardingFlow` (signed in): the first-task cards (2026-09-25). A task
 *     card starts at once; there is no prompt screen. _layout.tsx shows it
 *     only to an account that is not established, so an existing customer
 *     goes straight to the app. A new account's Computer is being set up while
 *     they choose.
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
import { useState } from "react";
import { View } from "react-native";

import { CardsScreen } from "./onboarding-cards";
import { QuestionScreen } from "./onboarding-questions";
import { SignInDrawer } from "./onboarding-signin-drawer";
import { WelcomeScreen } from "./onboarding-welcome";
import { compose, taskFor, type CardKey, type FirstTask, type InterestKey } from "./onboarding-tasks";
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

export type OnboardingChoice = {
  /** The task card picked. */
  interest: InterestKey | null;
  taskId: string | null;
  /** What gets run: the card's prompt, unedited. */
  prompt: string;
  /** Kept for the handoff's shape; the cards pick no files. */
  files: PickedFile[];
};

/**
 * After sign-in: the first-task cards. A task card goes to `onDone` with its
 * prompt and starts; the agents card goes to `onAgents`.
 *
 * `startAt` is "cards" on first run: Welcome was the screen before sign-in.
 * The replay from Settings starts at "welcome" so it shows the whole flow.
 */
export function OnboardingFlow({
  onDone,
  onAgents,
  startAt = "cards",
  initialKey = null,
}: {
  onDone: (choice: OnboardingChoice) => void;
  onAgents: () => void;
  startAt?: "welcome" | "cards";
  /** Reopen with this card in view ("Not now" on the data notice). */
  initialKey?: CardKey | null;
}) {
  const { colors } = useTheme();
  const [step, setStep] = useState<"welcome" | "cards" | "questions">(startAt);
  /** The task card picked, while its questions are open. */
  const [task, setTask] = useState<FirstTask | null>(null);
  const [question, setQuestion] = useState(0);
  const [picks, setPicks] = useState<[number | null, number | null, number | null]>([null, null, null]);

  const pick = (key: CardKey) => {
    const next = taskFor(key);
    if (!next) return onAgents();
    // A different card starts its questions fresh.
    if (next.key !== task?.key) setPicks([null, null, null]);
    setTask(next);
    setQuestion(0);
    setStep("questions");
  };

  const answer = (index: number) => {
    if (!task) return;
    const next: typeof picks = [...picks];
    next[question] = index;
    setPicks(next);
    if (question < 2) return setQuestion(question + 1);
    const chosen = next.map((p) => p ?? 0) as [number, number, number];
    onDone({ interest: task.key, taskId: task.key, prompt: compose(task, chosen), files: [] });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {step === "welcome" ? <WelcomeScreen onStart={() => setStep("cards")} /> : null}
      {step === "cards" ? (
        <CardsScreen
          initialKey={initialKey}
          onPick={pick}
          // First run has no screen before this one: Welcome was signed out.
          onBack={startAt === "welcome" ? () => setStep("welcome") : undefined}
        />
      ) : null}
      {step === "questions" && task ? (
        <QuestionScreen
          task={task}
          step={question}
          chosen={picks[question]}
          onAnswer={answer}
          onBack={() => (question > 0 ? setQuestion(question - 1) : setStep("cards"))}
        />
      ) : null}
    </View>
  );
}
