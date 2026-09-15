/**
 * The rules the pre-sign-in flow has to keep. These are decisions, not
 * rendering: which prompt a step opens with, and what a lane change does to
 * the task under it.
 */
import { expect, test } from "bun:test";
import { promptFor, laneFor, INTEREST_LANES } from "../src/omg/onboarding-tasks";

/** Mirrors OnboardingFlow's reducer: the parts worth pinning without a renderer. */
function chooseLane(state: { interest: string | null; taskId: string | null }, key: string) {
  return { interest: key, taskId: key === state.interest ? state.taskId : null };
}

test("changing lane drops the task chosen under the old one", () => {
  const picked = { interest: "design", taskId: "design-ads" };
  // Task ids are lane-scoped; one left behind would prefill nothing at all.
  expect(chooseLane(picked, "code").taskId).toBeNull();
  expect(promptFor("code", "design-ads")).toBeNull();
});

test("re-picking the same lane keeps the task, so back does not clear a choice", () => {
  const picked = { interest: "design", taskId: "design-ads" };
  expect(chooseLane(picked, "design").taskId).toBe("design-ads");
});

test("every lane's first task prefills something, so Continue is never a dead end", () => {
  for (const lane of INTEREST_LANES) {
    const first = laneFor(lane.key)!.tasks[0]!;
    expect(promptFor(lane.key, first.id)!.length).toBeGreaterThan(0);
  }
});

/**
 * The own-idea path opens blank. Prefilled text somebody has to delete before
 * they can type is worse than a placeholder, and the design draws it empty.
 */
test("the own-idea path has no prompt to inherit", () => {
  expect(promptFor(null, null)).toBeNull();
  for (const lane of INTEREST_LANES) expect(promptFor(lane.key, null)).toBeNull();
});
