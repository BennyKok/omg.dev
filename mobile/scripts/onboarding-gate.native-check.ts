/**
 * Who is still owed the connect step. The rule is Benny's: connecting agent
 * subscriptions happens AFTER the paywall, for everyone who walked the new
 * flow, whether they paid or skipped.
 */
import { expect, test } from "bun:test";
import {
  NEW_ACCOUNT_WINDOW_MS,
  firstRunDoneElsewhere,
  isNewAccount,
  shouldMarkOnboarded,
  shouldShowSetup,
} from "../src/omg/onboarding-gate";

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

test("an account created moments ago is a new sign-up", () => {
  const now = Date.parse("2026-09-24T10:00:30Z");
  expect(isNewAccount("2026-09-24T10:00:00.000Z", now)).toBe(true);
});

test("an older account is a returning customer, even on the free plan", () => {
  const now = Date.parse("2026-09-24T10:00:00Z");
  expect(isNewAccount(new Date(now - NEW_ACCOUNT_WINDOW_MS - 1000).toISOString(), now)).toBe(false);
  expect(isNewAccount("2026-08-01T00:00:00.000Z", now)).toBe(false);
});

test("a clock a little ahead of the server still reads as new", () => {
  const now = Date.parse("2026-09-24T10:00:00Z");
  expect(isNewAccount("2026-09-24T10:02:00.000Z", now)).toBe(true);
});

test("a missing or unreadable time is unknown, not a guess", () => {
  expect(isNewAccount(undefined)).toBeNull();
  expect(isNewAccount("not a date")).toBeNull();
});

test("the shared record skips the cards only when another client finished them", () => {
  expect(firstRunDoneElsewhere({ needed: false, doneAt: 1_800_000_000_000 })).toBe(true);
  expect(firstRunDoneElsewhere({ needed: true, doneAt: null })).toBe(false);
  // Unknown (older server, no network) never hides the cards.
  expect(firstRunDoneElsewhere(null)).toBe(false);
});
