/**
 * Replay of the welcome flow, from Settings.
 *
 * First run shows these screens as GATES in _layout.tsx, not routes, so they
 * cannot be deep-linked into by accident. Replay is the opposite case: someone
 * signed in asked to see them again, so a plain route is right.
 *
 * ── A replay is a look, not a re-run ──────────────────────────────────────
 *
 * Nothing here writes the onboarding flags, nothing stashes a prompt, and
 * nothing creates a session. The sign-in drawer is not shown: asking somebody
 * to sign in while they are signed in is a dead end. So the replay runs
 * Welcome straight into the questions, and the last button reads "Continue".
 *
 * ── It shows the CURRENT flow ─────────────────────────────────────────────
 *
 * This rendered `IntroScreen`, the three pitch panels the revamp replaced, for
 * as long as the revamp has been shipping. Anyone who opened it was shown last
 * month's app and had no way to know that. A replay that is out of date is
 * worse than no replay: it is a wrong answer to "what does a new user see".
 *
 * Steps 04 to 06 are not here. They are the real session being created and
 * then paid for, and neither is something to re-enact.
 */

import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { SetupScreen, rosterFromReadiness } from "../src/omg/onboarding";
import { OnboardingFlow } from "../src/omg/onboarding-flow";
import { useOmg } from "../src/omg/provider";
import { useTheme } from "../src/omg/theme";

export default function OnboardingReplayScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const { readiness, probe } = useOmg();
  const [phase, setPhase] = useState<"intro" | "setup">("intro");
  const { agents, waking } = rosterFromReadiness(readiness);

  const done = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, [router]);

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      {phase === "intro" ? (
        <OnboardingFlow
          startAt="welcome"
          finalLabel="Continue"
          // The written prompt is DROPPED on purpose. Running it would create a
          // real session from a screen somebody opened to look at, which is the
          // opposite of what "replay" means.
          onDone={() => setPhase("setup")}
        />
      ) : (
        <SetupScreen onDone={done} agents={agents} waking={waking} onConnected={probe} />
      )}
    </>
  );
}
