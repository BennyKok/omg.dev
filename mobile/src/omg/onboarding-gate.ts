/**
 * Two predicates from the signed-in gate chain in app/_layout.tsx.
 *
 * Only two, and only these: the pair that decides whether somebody is still
 * owed the connect step. Everything else in that chain is ordering, and
 * ordering is readable where it is. These are not, because they encode a rule
 * that is invisible from the condition alone -- and getting either wrong is
 * silent. Nobody sees a screen that did not appear.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * Benny put connecting agent subscriptions AFTER the paywall: it happens once
 * somebody has seen their first session work, whether they paid or skipped.
 *
 * That collides with `established`, the predicate that keeps a returning
 * account out of setup. Buying a plan in step 06 makes `established` true
 * seconds before the setup gate is reached, so a payer -- and only a payer --
 * would skip the step. `newArrival` is the fact that separates the two cases:
 * this person walked the new flow just now.
 */
export type OnboardingGateInput = {
  /** From useOnboarding(). Only "needed" can show anything. */
  state: "loading" | "needed" | "done";
  /** An existing Computer OR a non-free plan. */
  established: boolean;
  /** Steps 04 to 06 actually ran for this person during this launch. */
  newArrival: boolean;
  machinesLoaded: boolean;
};

/**
 * Write the completed flag for an account that was already established, so
 * this stops being asked on every launch.
 *
 * Held off for a new arrival: they became established by paying, not by
 * having been here before, and completing now would close the flow over the
 * top of the step they have not seen yet.
 */
export function shouldMarkOnboarded(input: OnboardingGateInput): boolean {
  return input.state === "needed" && input.machinesLoaded && input.established && !input.newArrival;
}

/** Does the connect step still owe this person a visit? */
export function shouldShowSetup(input: OnboardingGateInput): boolean {
  return input.state === "needed" && (!input.established || input.newArrival);
}

/**
 * How recently an account must have been created to count as a new sign-up.
 *
 * An email or Apple sign-in creates the account at the moment of sign-in, so a
 * new person reaches the gate seconds after `createdAt`. An hour leaves room
 * for a slow code, the data notice and a phone clock that is a little off,
 * and anything older is somebody who has been here before.
 */
export const NEW_ACCOUNT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Is this a new sign-up? From the account's own creation time, so it needs no
 * computer list and cannot be fooled by a Computer that is being provisioned.
 *
 * `null` when the time is missing or unreadable (an older server, demo mode).
 * The caller then falls back to the `established` rule, which waits for the
 * machines.
 */
export function isNewAccount(createdAt: string | undefined, now: number = Date.now()): boolean | null {
  if (!createdAt) return null;
  const at = Date.parse(createdAt);
  if (Number.isNaN(at)) return null;
  // A creation time slightly in the future is clock skew on a brand-new account.
  return now - at < NEW_ACCOUNT_WINDOW_MS;
}
