/**
 * Carrying the onboarding answer across sign-in.
 *
 * The flow asks what you want BEFORE it asks who you are, which is the point
 * of the revamp -- and it means the answer has to outlive the moment that
 * creates the account. Signing in re-mounts the tree under it, so anything
 * held in component state at that instant is gone.
 *
 * AsyncStorage, not a module variable: the sign-in paths leave the app
 * entirely. Apple and Google hand off to a system sheet or a browser, and the
 * process can be killed while the person is over there. A value that only
 * lived in memory would be gone exactly when they came back having succeeded.
 *
 * It is a HANDOFF, not a record. Read once, then cleared -- a prompt that
 * survived to a second launch would quietly re-run somebody's first task weeks
 * later, which is worse than losing it.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { PickedFile } from "./attachments";
import type { InterestKey } from "./onboarding-tasks";

const KEY = "omg.onboarding.handoff.v1";

export type OnboardingHandoff = {
  interest: InterestKey | null;
  taskId: string | null;
  prompt: string;
  /**
   * Files picked on step 03, as LOCAL URIs. There was nowhere to upload them
   * yet -- no account, no Computer -- so they cross sign-in unsent and are
   * uploaded by onboarding-launch.ts. Both pickers copy into this app's cache
   * directory, which outlives the process being killed while somebody is over
   * in a browser signing in.
   */
  files?: PickedFile[];
  /** When it was stashed, so a stale one can be thrown away rather than run. */
  at: number;
};

/**
 * Older than this and it is not a handoff any more, it is a surprise. Sign-in
 * takes seconds; an hour covers a browser round trip, a password reset and a
 * distracted user, and still cannot reach tomorrow morning.
 */
export const HANDOFF_MAX_AGE_MS = 60 * 60 * 1000;

export async function stashOnboardingChoice(
  choice: {
    interest: InterestKey | null;
    taskId: string | null;
    prompt: string;
    files?: PickedFile[];
  },
): Promise<void> {
  // Nothing written means nothing to run. An empty prompt is not an answer,
  // and storing one would make the reader branch on a value it cannot use.
  if (!choice.prompt.trim()) return;
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({ ...choice, prompt: choice.prompt.trim(), at: Date.now() } satisfies OnboardingHandoff),
  ).catch(() => {
    // Storage refused. The account is still being created and the flow must
    // not stall on a cache write; the person can type it again.
  });
}

function usable(raw: string | null, now: number): OnboardingHandoff | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OnboardingHandoff;
    if (!parsed?.prompt?.trim()) return null;
    if (typeof parsed.at !== "number" || now - parsed.at > HANDOFF_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Is there anything to run? Reads WITHOUT clearing.
 *
 * The caller has to wait for a Computer before it can act, and that wait has a
 * ceiling measured in a minute and a half. Asking this first means somebody
 * with nothing stashed -- an account created before the revamp, anyone who
 * reached sign-in another way -- is not held on a splash for that minute
 * waiting for a machine they have no use for yet.
 */
export async function hasOnboardingChoice(now: number = Date.now()): Promise<boolean> {
  return usable(await AsyncStorage.getItem(KEY).catch(() => null), now) !== null;
}

/** Read and clear. Returns null when there is nothing, or it is too old. */
export async function takeOnboardingChoice(
  now: number = Date.now(),
): Promise<OnboardingHandoff | null> {
  const raw = await AsyncStorage.getItem(KEY).catch(() => null);
  if (!raw) return null;
  // Cleared even when it turns out to be stale or corrupt, so the next launch
  // is clean either way.
  await AsyncStorage.removeItem(KEY).catch(() => {});
  return usable(raw, now);
}
