/**
 * Turning the onboarding answer into a real session, once there is an account.
 *
 * This is the join between the two halves of the revamp: step 03 collects a
 * prompt before sign-in, and this runs it after. Without it the flow is a
 * questionnaire.
 *
 * ── It runs once, and only for a genuinely new arrival ────────────────────
 *
 * takeOnboardingChoice() reads and clears, so a failure here does not leave a
 * prompt lying around to ambush a later launch. The hour ceiling in that
 * module is the other half of the same guarantee.
 *
 * ── Everything it needs may not be ready at once ──────────────────────────
 *
 * Signing in resolves an account, a Computer and a live client at different
 * moments. Asking before they exist is the ordinary case, not an error, so the
 * caller polls this and it simply reports "not yet" until it can act.
 */
import type { OmgClient } from "@omg-dev/client";

import { takeOnboardingChoice } from "./onboarding-handoff";

export type LaunchOutcome =
  /** Nothing stashed, or it was too old. Normal for everyone but a new arrival. */
  | { kind: "nothing" }
  /** The pieces are not all here yet. Ask again; nothing was consumed. */
  | { kind: "not-ready" }
  | { kind: "started"; sessionId: string; prompt: string }
  /** The prompt is gone either way; say so rather than silently dropping it. */
  | { kind: "failed"; prompt: string; error: string };

export async function launchOnboardingTask(
  client: OmgClient | null,
  ready: boolean,
  cwd?: string | null,
): Promise<LaunchOutcome> {
  // Check readiness BEFORE reading, because reading consumes. Getting this
  // order wrong would eat the prompt on the first render after sign-in, when
  // the client is reliably still null.
  if (!client || !ready) return { kind: "not-ready" };

  const choice = await takeOnboardingChoice();
  if (!choice) return { kind: "nothing" };

  try {
    const result = await client.transport.request<{ sessionId?: string }>("/api/sessions/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: choice.prompt,
        // No agent, model or account is named. The box has defaults per
        // agent and picks the Claude login with the most capacity left; a
        // first-run guess from this side would be worse than either.
        cwd: cwd ?? undefined,
      }),
    });
    const sessionId = result?.sessionId;
    if (!sessionId) return { kind: "failed", prompt: choice.prompt, error: "No session was created" };
    return { kind: "started", sessionId, prompt: choice.prompt };
  } catch (e) {
    return {
      kind: "failed",
      prompt: choice.prompt,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
