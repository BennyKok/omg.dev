import { describe, expect, test } from "bun:test";
import {
  hostedCoachSteps,
  shouldShowHostedCoach,
  unrecordedHostedCoachSteps,
} from "./hosted-coach.ts";

const FRESH = { coach: { session: false, schedule: false }, sessionCount: 0, autoAgentCount: 0 };

describe("hostedCoachSteps", () => {
  test("a fresh hosted box has everything left to do", () => {
    const steps = hostedCoachSteps(FRESH);
    expect(steps.map((s) => s.key)).toEqual(["session", "schedule"]);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  test("a recorded flag completes its step", () => {
    const steps = hostedCoachSteps({ ...FRESH, coach: { session: true, schedule: false } });
    expect(steps.find((s) => s.key === "session")?.done).toBe(true);
    expect(steps.find((s) => s.key === "schedule")?.done).toBe(false);
  });

  // The flag write is fire-and-forget, so evidence has to count on its own.
  // Otherwise a box that missed the POST teaches "start your first session" to
  // someone looking at the session they started.
  test("evidence on the box completes a step the server never recorded", () => {
    const steps = hostedCoachSteps({ ...FRESH, sessionCount: 1, autoAgentCount: 2 });
    expect(steps.every((s) => s.done)).toBe(true);
  });

  test("a missing coach block is treated as nothing done, not as a crash", () => {
    const steps = hostedCoachSteps({ coach: null, sessionCount: 0, autoAgentCount: 0 });
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  // Persisted completion outlives the evidence: clearing your only session
  // does not put you back at the start of the tour.
  test("a recorded step stays done after its evidence is gone", () => {
    const steps = hostedCoachSteps({
      coach: { session: true, schedule: true },
      sessionCount: 0,
      autoAgentCount: 0,
    });
    expect(steps.every((s) => s.done)).toBe(true);
  });
});

describe("unrecordedHostedCoachSteps", () => {
  test("reports only the steps the box can prove and the server has not stored", () => {
    expect(
      unrecordedHostedCoachSteps({
        coach: { session: true, schedule: false },
        sessionCount: 3,
        autoAgentCount: 1,
      }),
    ).toEqual(["schedule"]);
  });

  test("proves nothing on an empty box", () => {
    expect(unrecordedHostedCoachSteps(FRESH)).toEqual([]);
  });
});

describe("shouldShowHostedCoach", () => {
  const open = {
    embedded: true,
    bare: false,
    introSeen: true,
    coachLoaded: true,
    steps: hostedCoachSteps(FRESH),
  };

  test("shows on a framed box that is past its intro with work left", () => {
    expect(shouldShowHostedCoach(open)).toBe(true);
  });

  test("standalone lfg never sees it — OnboardingFlow owns that screen", () => {
    expect(shouldShowHostedCoach({ ...open, embedded: false })).toBe(false);
  });

  test("a bare surface renders the page it was asked for", () => {
    expect(shouldShowHostedCoach({ ...open, bare: true })).toBe(false);
  });

  test("stays out of the connect gate's way until the intro is done", () => {
    expect(shouldShowHostedCoach({ ...open, introSeen: false })).toBe(false);
  });

  test("unknown state stays quiet rather than flashing a fresh checklist", () => {
    expect(shouldShowHostedCoach({ ...open, coachLoaded: false })).toBe(false);
  });

  test("disappears once every step is done", () => {
    const steps = hostedCoachSteps({ ...FRESH, sessionCount: 1, autoAgentCount: 1 });
    expect(shouldShowHostedCoach({ ...open, steps })).toBe(false);
  });
});
