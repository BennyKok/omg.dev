/**
 * Replay of the welcome flow, from Settings.
 *
 * First run shows these screens as GATES in _layout.tsx, not routes, so they
 * cannot be deep-linked into by accident. Replay is the opposite case: someone
 * signed in asked to see them again, so a plain route is right. Nothing here
 * writes the onboarding flags; a replay is a look, not a re-run of setup.
 *
 * The intro's last button reads "Continue" rather than "Sign in", and both
 * the intro's exits lead to the setup steps. Setup's exits pop back to
 * Settings.
 */

import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { IntroScreen, SetupScreen, rosterFromReadiness } from "../src/omg/onboarding";
import { useOmg } from "../src/omg/provider";
import { useTheme } from "../src/omg/theme";

export default function OnboardingReplayScreen() {
  const router = useRouter();
  const { isDark } = useTheme();
  const { readiness } = useOmg();
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
        <IntroScreen finalLabel="Continue" onSignIn={() => setPhase("setup")} />
      ) : (
        <SetupScreen onDone={done} agents={agents} waking={waking} />
      )}
    </>
  );
}
