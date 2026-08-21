// Hosted first-run coach steps: what a provisioned omg Computer still has to
// show someone AFTER the connect gate is done with them.
//
// Why this exists as its own module, next to embedded-connect.ts: the server
// has carried `onboarding.hosted.coach` ({ session, schedule }) since the
// hosted first run was brought back, and nothing has ever read it. The state
// shipped, the surface did not. So a fresh hosted account finishes (or skips)
// the connect gate and lands on a completely empty home — "No running
// sessions", a composer, and no indication of what this box is for. The two
// things the hosted flow is supposed to teach ("run one session", "let one run
// on a schedule") were only ever expressible as a reset.
//
// The rule for the OSS flow does not transfer. `OnboardingSteps` walks an empty
// box up (identity, CLIs, repo) and owns the whole screen while it does it.
// A hosted Computer arrives provisioned, so its remaining steps are not a wall
// in front of the app — they are a panel inside it, and the app stays usable
// with the panel unread.

export type HostedCoachKey = "session" | "schedule";

/** The server's `onboarding.hosted.coach` block. */
export type HostedCoachFlags = Record<HostedCoachKey, boolean>;

export type HostedCoachStep = {
  key: HostedCoachKey;
  title: string;
  detail: string;
  done: boolean;
};

const COPY: Record<HostedCoachKey, { title: string; detail: string }> = {
  session: {
    title: "Start your first session",
    detail: "Describe a task in the composer. An agent picks it up and works in the background.",
  },
  schedule: {
    title: "Put an agent on a schedule",
    detail: "Auto agents run on their own and post what they find, with nobody watching.",
  },
};

/**
 * Resolve the coach steps for this Computer.
 *
 * A step counts as done when the server recorded it OR when the box already
 * shows the evidence for it. Both halves are load-bearing:
 *
 * - Recorded-only would re-teach "start your first session" to someone whose
 *   very first act was to start a session, because the flag write is
 *   fire-and-forget and a hosted box that never got the POST would nag forever.
 * - Evidence-only would forget a step the moment its session was cleared, and
 *   "you have done this before" is exactly the thing worth persisting.
 */
export function hostedCoachSteps(input: {
  coach?: Partial<HostedCoachFlags> | null;
  sessionCount: number;
  autoAgentCount: number;
}): HostedCoachStep[] {
  const evidence: HostedCoachFlags = {
    session: input.sessionCount > 0,
    schedule: input.autoAgentCount > 0,
  };
  return (Object.keys(COPY) as HostedCoachKey[]).map((key) => ({
    key,
    ...COPY[key],
    done: input.coach?.[key] === true || evidence[key],
  }));
}

/** Which steps the server has not recorded yet but the box can now prove. */
export function unrecordedHostedCoachSteps(input: {
  coach?: Partial<HostedCoachFlags> | null;
  sessionCount: number;
  autoAgentCount: number;
}): HostedCoachKey[] {
  const evidence: HostedCoachFlags = {
    session: input.sessionCount > 0,
    schedule: input.autoAgentCount > 0,
  };
  return (Object.keys(COPY) as HostedCoachKey[]).filter(
    (key) => evidence[key] && input.coach?.[key] !== true,
  );
}

/**
 * Show the panel only on a framed surface that is past its intro, and only
 * while something is left to teach.
 *
 * - `!embedded` is the OSS flow's territory; OnboardingFlow owns that screen.
 * - `bare` is a host mounting ONE page. It asked for that page. Same reasoning
 *   as shouldShowEmbeddedConnectGate.
 * - `!introSeen` means the connect gate is still ahead of (or on) the screen.
 *   Two first-run surfaces at once is one too many.
 * - `coachLoaded: false` is "bootstrap has not answered yet". Rendering a
 *   fresh-looking checklist on an unknown state would flash the panel at
 *   someone who finished it months ago, so unknown stays quiet.
 */
export function shouldShowHostedCoach(input: {
  embedded: boolean;
  bare?: boolean;
  introSeen: boolean;
  coachLoaded: boolean;
  steps: HostedCoachStep[];
}): boolean {
  if (!input.embedded || input.bare) return false;
  if (!input.introSeen || !input.coachLoaded) return false;
  return input.steps.some((step) => !step.done);
}
