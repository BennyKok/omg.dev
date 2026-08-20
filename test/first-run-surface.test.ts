// Static half of the first-run guard. The rendering half is
// web/src/first-run-e2e.test.ts, which mounts the real app surface; this file
// covers the cheaper, more general invariant:
//
//   every piece of first-run state the SERVER persists must have a reader and
//   a surface in the web app.
//
// The bug that motivated both files was not a wrong value. `hosted.coach`
// ({ session, schedule }) was written, sanitized, patch-merged, reset by
// "restart the tour" and asserted on by src/onboarding-hosted.test.ts — all
// green, for the whole life of the field — while nothing read it. A fresh
// hosted account therefore got an empty home. Roughly 37 test files in this
// repo assert on App.tsx by matching substrings, and a substring check for
// "coach" passed the entire time, because App.tsx did contain the word: in
// the reset that CLEARS the state.
//
// Hence the direction here. Expectations are derived from src/onboarding.ts
// rather than restated, so adding a field is what makes the test demand a
// surface for it.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const onboardingSrc = readFileSync("src/onboarding.ts", "utf8");
const appSrc = readFileSync("web/src/App.tsx", "utf8");
const coachLibSrc = readFileSync("web/src/lib/hosted-coach.ts", "utf8");

/** Hosted coach steps, parsed from the server's own defaults. */
function serverCoachKeys(): string[] {
  const block = onboardingSrc.match(/const DEFAULT_HOSTED:[\s\S]*?coach:\s*\{([^}]*)\}/);
  if (!block) throw new Error("could not find DEFAULT_HOSTED.coach in src/onboarding.ts");
  return [...block[1]!.matchAll(/(\w+)\s*:/g)].map((m) => m[1]!);
}

/** Top-level fields of HostedFirstRun. */
function hostedFirstRunFields(): string[] {
  const block = onboardingSrc.match(/export type HostedFirstRun = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error("could not find HostedFirstRun in src/onboarding.ts");
  return [...block[1]!.matchAll(/^\s{2}(\w+)\s*[?:]/gm)].map((m) => m[1]!);
}

describe("first-run state parsing", () => {
  // A test that derives its expectations from source fails open when the
  // regex misses: every assertion below would pass over an empty list. Pin
  // the parse itself so that cannot happen quietly.
  test("the server's first-run shape is readable, and is what we think it is", () => {
    expect(serverCoachKeys()).toContain("session");
    expect(serverCoachKeys().length).toBeGreaterThanOrEqual(2);
    expect(hostedFirstRunFields().sort()).toEqual(["coach", "introDoneAt"]);
  });
});

describe("hosted first-run state has a surface", () => {
  test("every HostedFirstRun field is READ by the web app, not only written", () => {
    for (const field of hostedFirstRunFields()) {
      expect(
        new RegExp(`hosted\\s*\\??\\.\\s*${field}\\b`).test(appSrc),
        `web/src/App.tsx never reads onboarding.hosted.${field}.\n` +
          `State nothing reads is not a feature. It renders as an empty screen on a ` +
          `fresh account while every state-level test keeps passing — which is exactly ` +
          `how hosted.coach shipped invisible.`,
      ).toBe(true);
    }
  });

  test("every coach step the server records has user-facing copy", () => {
    for (const key of serverCoachKeys()) {
      expect(
        new RegExp(`\\b${key}\\s*:\\s*\\{`).test(coachLibSrc),
        `web/src/lib/hosted-coach.ts has no copy for the "${key}" coach step, so the ` +
          `server can complete a step the person was never shown.`,
      ).toBe(true);
    }
  });

  test("the getting-started card is mounted, not merely defined", () => {
    // Import, use, hand off, and — the part that actually puts pixels on a
    // screen — a receiving view that renders the prop instead of dropping it.
    expect(appSrc).toContain('from "./components/hosted-coach-card"');
    expect(appSrc).toMatch(/<HostedCoachCard\b/);
    expect(appSrc).toMatch(/coach=\{/);
    // Both the phone empty state and the populated list: the panel has to
    // outlive the first session it asks the person to start.
    expect(appSrc.split("{coach}").length - 1).toBeGreaterThanOrEqual(2);
  });

  test("the panel waits for the connect gate instead of competing with it", () => {
    // The gate replaces the entire tree, so a panel rendered behind it is
    // unreachable and one rendered over it is noise.
    expect(coachLibSrc).toContain("introSeen");
    expect(appSrc).toMatch(/introSeen:\s*hostedIntroSeen/);
  });

  test("progress is recorded server-side so it does not re-teach per device", () => {
    // hosted.coach is per-Computer state; a localStorage-only panel would ask
    // the same person to start their first session again on their laptop.
    expect(appSrc).toContain("markHostedCoach");
    expect(appSrc).toContain("hostedCoach:");
    expect(onboardingSrc).toContain("hostedCoach");
  });
});
