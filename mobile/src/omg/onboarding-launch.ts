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

import type { InterestKey } from "./onboarding-tasks";
import type { PickedFile } from "./attachments";

import { composeAttachmentMessage } from "./attachment-message";
import { uploadAttachment } from "./attachment-upload";
import { hasOnboardingChoice, takeOnboardingChoice } from "./onboarding-handoff";
import { markFirstRunRecordDone } from "./first-run-record";

export type LaunchOutcome =
  /** Nothing stashed, or it was too old. Normal for everyone but a new arrival. */
  | { kind: "nothing" }
  /** The pieces are not all here yet. Ask again; nothing was consumed. */
  | { kind: "not-ready" }
  /** `interest` rides along because the screens after sign-in need the word
   *  the person chose, and the component state that held it is gone: signing
   *  in re-mounts the tree. The stash is the only copy left. */
  | { kind: "started"; sessionId: string; prompt: string; interest: InterestKey | null }
  /** The prompt is gone either way; say so rather than silently dropping it. */
  | { kind: "failed"; prompt: string; error: string };

/**
 * Send the files picked on step 03 to the Computer, and name them.
 *
 * They go to `/api/uploads`, the pre-session endpoint the home composer uses,
 * because the paths have to be IN the prompt that creates the session -- the
 * first message is the prompt, and there is no second one to attach to.
 *
 * A file that will not upload is DROPPED, not fatal. The cache copy can be
 * gone if the system reclaimed it while somebody was in a browser signing in,
 * and losing a reference is a much smaller loss than refusing to start the
 * task it was attached to. Nothing here can make the launch fail.
 */
async function attach(
  client: OmgClient,
  prompt: string,
  files: readonly PickedFile[],
): Promise<string> {
  const attached: { name: string; path: string }[] = [];
  for (const file of files) {
    try {
      const blob = await fetch(file.uri).then((r) => r.blob());
      const path = await uploadAttachment(
        client.transport,
        `/api/uploads?filename=${encodeURIComponent(file.name)}`,
        blob,
        file.mimeType,
        `onboarding-${file.name}-${Date.now()}`,
        // No progress to draw. This runs behind the splash while the flow is
        // still deciding what to show, and there is no row to put a bar on.
        () => {},
      );
      if (path) attached.push({ name: file.name, path });
    } catch {
      // See above: a reference that cannot be delivered must not take the
      // task down with it.
    }
  }
  return composeAttachmentMessage(prompt, attached);
}

/** How long one launch request may take before it counts as failed. */
export const LAUNCH_REQUEST_TIMEOUT_MS = 60_000;

export async function launchOnboardingTask(
  client: OmgClient | null,
  ready: boolean,
  cwd?: string | null,
): Promise<LaunchOutcome> {
  // "Is there anything?" first, and it does not consume. Answering "nothing"
  // before the readiness check is what keeps an account with no stashed prompt
  // from being parked on a splash while the caller waits out its ceiling for a
  // Computer it has no use for.
  if (!(await hasOnboardingChoice())) return { kind: "nothing" };

  // Readiness BEFORE the consuming read. Getting this order wrong would eat
  // the prompt on the first render after sign-in, when the client is reliably
  // still null.
  if (!client || !ready) return { kind: "not-ready" };

  const choice = await takeOnboardingChoice();
  // Raced with another reader, or it aged out between the two reads.
  if (!choice) return { kind: "nothing" };

  try {
    // The attachment block has to be part of the prompt, because the prompt IS
    // the session's first message.
    const prompt = choice.files?.length
      ? await attach(client, choice.prompt, choice.files)
      : choice.prompt;
    const result = await client.transport.request<{ sessionId?: string }>("/api/sessions/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        // No agent, model or account is named. The box has defaults per
        // agent and picks the Claude login with the most capacity left; a
        // first-run guess from this side would be worse than either.
        cwd: cwd ?? undefined,
      }),
      // Bounded. A launch that never answers must become a "failed" outcome
      // with the prompt still on screen, not a splash with no way out.
      signal: AbortSignal.timeout(LAUNCH_REQUEST_TIMEOUT_MS),
    });
    const sessionId = result?.sessionId;
    if (!sessionId) return { kind: "failed", prompt: choice.prompt, error: "No session was created" };
    // The first task exists, so the first run is done for the whole account
    // (web included). Fire and forget; see first-run-record.ts.
    void markFirstRunRecordDone();
    return { kind: "started", sessionId, prompt: choice.prompt, interest: choice.interest ?? null };
  } catch (e) {
    return {
      kind: "failed",
      prompt: choice.prompt,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
