/**
 * Steps 04 to 06: what happens once there is an account.
 *
 * The other half of the revamp. Steps 01 to 03 run before sign-in and stash a
 * prompt; this launches it, shows it working, shows the real session, and then
 * offers a plan. Without it the first half is a questionnaire.
 *
 * ── The waiting is bounded, because the alternative is a deadlock ─────────
 *
 * Signing in resolves an account, a Computer and a live client at different
 * moments, so "not ready yet" is the ordinary first answer and this polls. But
 * a new account might never get a Computer at all -- no cloud machine, a
 * control-plane refusal, an offline laptop -- and a gate that waits forever in
 * front of the signed-in tree is exactly the shape of the #237 splash
 * deadlock, with no way out but reinstalling.
 *
 * So the wait has a ceiling. When it runs out this hands control back and the
 * normal setup gate takes over. `launchOnboardingTask` consumes NOTHING while
 * it reports "not ready", so the prompt is still in the stash afterwards and
 * whoever reaches a Computer next can still run it.
 *
 * ── A failed launch does not eat the words ────────────────────────────────
 *
 * The stash is read-once, so by the time a failure is known it is already
 * consumed. The prompt comes back inside the outcome and goes on screen with a
 * retry, because losing the first thing somebody wrote is the worst outcome
 * this flow has.
 *
 * ── Every screen here can be left ─────────────────────────────────────────
 *
 * Nothing in 04 to 06 is a precondition for using the app. A flow that traps a
 * paying customer behind a notification prompt or an unreachable store is
 * worse than one they skip.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import type { OmgClient } from "@omg-dev/client";

import { ContinueScreen } from "./onboarding-continue";
import { launchOnboardingTask, type LaunchOutcome } from "./onboarding-launch";
import { OnboardingTranscript } from "./onboarding-transcript";
import { PlanScreen } from "./onboarding-plan";
import { PrimaryAction, SecondaryAction, StepHeading } from "./onboarding-chrome";
import { WorkingScreen } from "./onboarding-working";
import { Text } from "./text";
import { useTheme } from "./theme";

/**
 * How long to wait for a Computer before giving up and handing back.
 *
 * A cold cloud provision is seconds (see readiness.ts, which allows a minute
 * of 425s before it calls something wrong). Ninety seconds covers that with
 * room to spare and is still short enough that somebody who is never going to
 * get a Computer is not staring at a breathing logo.
 */
export const LAUNCH_WAIT_MS = 90_000;
const POLL_MS = 1_000;

type Stage = "launching" | "working" | "continue" | "plan";

export function OnboardingAfterSignIn({
  client,
  ready,
  cwd,
  agent,
  runningCount,
  onNotify,
  onOpenSession,
  onDone,
  splash,
}: {
  client: OmgClient | null;
  /** True once the Computer can actually serve a request. */
  ready: boolean;
  cwd?: string | null;
  agent: string;
  runningCount: number;
  onNotify: () => void;
  /** Leave the flow and land on the session it created. */
  onOpenSession: (sessionId: string) => void;
  /**
   * Leave the flow. `ran` says whether it actually walked somebody through a
   * first session, which is not the same as having finished: it is false for a
   * returning account with nothing stashed and for a Computer that never came
   * up. The caller uses it to decide whether the setup gate below still owes
   * this person a visit.
   */
  onDone: (ran: boolean) => void;
  splash: ReactNode;
}) {
  const { colors, space } = useTheme();
  const [stage, setStage] = useState<Stage>("launching");
  const [outcome, setOutcome] = useState<LaunchOutcome | null>(null);
  const [tick, setTick] = useState(0);
  const startedAt = useRef(Date.now());
  /**
   * One attempt in flight at a time, and the flag is set SYNCHRONOUSLY.
   *
   * The effect below re-runs whenever the client or readiness changes, and
   * both change while a request is open. Without this, two overlapping calls
   * could each consume the stash and each create a session -- two first tasks
   * from one prompt. `cancelled` cannot prevent that: it only ignores a
   * result, it does not un-send the request.
   */
  const inFlight = useRef(false);

  useEffect(() => {
    if (stage !== "launching" || inFlight.current) return;
    inFlight.current = true;
    let cancelled = false;
    void launchOnboardingTask(client, ready, cwd).then((next) => {
      // Released even when cancelled: the attempt is over either way, and a
      // flag left true would stop every later poll.
      inFlight.current = false;
      if (cancelled) return;
      if (next.kind === "not-ready") {
        // Nothing was consumed. Either come back in a second, or give up and
        // let the ordinary gates run -- the prompt survives both.
        if (Date.now() - startedAt.current >= LAUNCH_WAIT_MS) onDone(false);
        else setTimeout(() => setTick((n) => n + 1), POLL_MS);
        return;
      }
      setOutcome(next);
      // Nobody stashed anything. This is a returning account, not a new
      // arrival, and there is nothing after sign-in to show them.
      if (next.kind === "nothing") onDone(false);
      else if (next.kind === "started") setStage("working");
    });
    return () => {
      cancelled = true;
    };
  }, [stage, client, ready, cwd, tick, onDone]);

  if (outcome?.kind === "failed") {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          justifyContent: "center",
          padding: space.lg + 4,
          gap: space.xl,
        }}
      >
        <StepHeading
          title={"That did not\nstart."}
          body="Your computer did not take the task. Nothing else was lost."
        />
        {/*
         * The words come back on screen. The stash is read-once, so this is
         * the only copy left and dropping it loses the first thing they wrote.
         */}
        <View style={{ padding: space.lg, borderRadius: 12, backgroundColor: colors.card }}>
          <Text style={{ color: colors.text }}>{outcome.prompt}</Text>
        </View>
        <View style={{ gap: space.md }}>
          <PrimaryAction
            label="Try again"
            onPress={() => {
              setOutcome(null);
              inFlight.current = false;
              startedAt.current = Date.now();
              setStage("launching");
              setTick((n) => n + 1);
            }}
          />
          <SecondaryAction label="Skip for now" onPress={() => onDone(true)} />
        </View>
      </View>
    );
  }

  if (stage === "launching" || outcome?.kind !== "started") return <>{splash}</>;

  if (stage === "working") {
    return (
      <WorkingScreen
        title={outcome.prompt}
        agent={agent}
        runningCount={Math.max(1, runningCount)}
        onNotify={() => {
          onNotify();
          setStage("continue");
        }}
        onSkip={() => setStage("continue")}
        // Back from the first screen after sign-in cannot go back to sign-in,
        // so it goes forward. There is no earlier state to return to.
        onBack={() => setStage("continue")}
      />
    );
  }

  if (stage === "continue") {
    return (
      <ContinueScreen
        interest={outcome.interest}
        transcript={<OnboardingTranscript client={client} sessionId={outcome.sessionId} />}
        onOpen={() => setStage("plan")}
        onBack={() => setStage("working")}
      />
    );
  }

  /*
   * All three exits land in the same place, with the session intact. Benny's
   * rule: connecting agent subscriptions happens AFTER this, whether they paid
   * or not, so this screen hands back rather than deciding anything.
   */
  const leave = () => {
    onDone(true);
    onOpenSession(outcome.sessionId);
  };
  return <PlanScreen onPurchased={leave} onSkip={leave} onClose={leave} />;
}
