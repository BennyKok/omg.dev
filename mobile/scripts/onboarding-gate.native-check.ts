/**
 * Who is still owed the connect step. The rule is Benny's: connecting agent
 * subscriptions happens AFTER the paywall, for everyone who walked the new
 * flow, whether they paid or skipped.
 */
import { expect, test } from "bun:test";
import { shouldMarkOnboarded, shouldShowSetup } from "../src/omg/onboarding-gate";

const base = { state: "needed", established: false, newArrival: false, machinesLoaded: true } as const;

test("a brand new account is shown setup", () => {
  expect(shouldShowSetup(base)).toBe(true);
  expect(shouldMarkOnboarded(base)).toBe(false);
});

test("an established account skips setup and is marked done", () => {
  const returning = { ...base, established: true };
  expect(shouldShowSetup(returning)).toBe(false);
  expect(shouldMarkOnboarded(returning)).toBe(true);
});

/**
 * THE CASE THIS FILE EXISTS FOR. Buying a plan in step 06 makes `established`
 * true seconds before the setup gate is reached. Without `newArrival` the
 * people who PAID -- and only them -- would silently never be asked to connect
 * an agent.
 */
test("paying inside the new flow does not skip the step that comes after it", () => {
  const paid = { ...base, established: true, newArrival: true };
  expect(shouldShowSetup(paid)).toBe(true);
  expect(shouldMarkOnboarded(paid)).toBe(false);
});

test("skipping the paywall lands in the same place as paying", () => {
  expect(shouldShowSetup({ ...base, newArrival: true })).toBe(true);
});

test("nothing is decided before the account's onboarding state is known", () => {
  for (const state of ["loading", "done"] as const) {
    expect(shouldShowSetup({ ...base, state })).toBe(false);
    expect(shouldMarkOnboarded({ ...base, state, established: true })).toBe(false);
  }
});

/**
 * `bindings` is empty during the first fetch as well as when there genuinely
 * is no Computer, and those are opposite answers. Marking somebody onboarded
 * on the unloaded state would suppress setup for the exact new account it
 * exists for.
 */
test("a judgement is not made before the machines have loaded", () => {
  expect(shouldMarkOnboarded({ ...base, established: true, machinesLoaded: false })).toBe(false);
});
