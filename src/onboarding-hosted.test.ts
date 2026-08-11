import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { getOnboarding, patchOnboarding } from "./onboarding.ts";

/**
 * Hosted (embedded) first-run progress.
 *
 * The behaviour under test is the one that made the embedded connect gate
 * unusable: its dismissal lived in a React useState, so "Skip for now" lasted
 * until the next reload and the gate came back on EVERY load until an agent was
 * connected — a permanent wall for anyone happy on the free credential-free
 * agent. Persisting it per-Computer is what makes re-enabling the gate safe.
 */
describe("hosted first-run state", () => {
  const originalData = PATHS.data;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "omg-onboarding-"));
    PATHS.data = root;
  });

  afterEach(() => {
    PATHS.data = originalData;
    rmSync(root, { recursive: true, force: true });
  });

  test("a fresh box has not seen the hosted intro", async () => {
    const state = await getOnboarding();
    expect(state.hosted.introDoneAt).toBeNull();
    expect(state.hosted.coach).toEqual({ session: false, schedule: false });
  });

  test("finishing the intro survives a reload — the whole point", async () => {
    await patchOnboarding({ hostedIntroDone: true });
    expect((await getOnboarding()).hosted.introDoneAt).toBeTruthy();
  });

  test("stamping the intro twice keeps the first timestamp", async () => {
    const first = (await patchOnboarding({ hostedIntroDone: true })).hosted.introDoneAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await patchOnboarding({ hostedIntroDone: true })).hosted.introDoneAt).toBe(first!);
  });

  test("restarting the tour clears it — a reset must be expressible, not just a completion", async () => {
    await patchOnboarding({ hostedIntroDone: true, hostedCoach: { session: true, schedule: true } });
    const reset = await patchOnboarding({
      hostedIntroDone: false,
      hostedCoach: { session: false, schedule: false },
    });
    expect(reset.hosted.introDoneAt).toBeNull();
    expect(reset.hosted.coach).toEqual({ session: false, schedule: false });
  });

  test("coach steps merge one at a time", async () => {
    await patchOnboarding({ hostedCoach: { session: true } });
    const state = await patchOnboarding({ hostedCoach: { schedule: true } });
    expect(state.hosted.coach).toEqual({ session: true, schedule: true });
  });

  test("hosted progress never touches the open-source flow's own steps", async () => {
    // The two flows are deliberately separate — the open-source walk stands an
    // EMPTY box up (profile, agent CLIs, repo), the hosted one teaches a box
    // that already exists. Sharing a field would make one silently complete
    // the other.
    await patchOnboarding({ steps: { profile: true, agents: true }, completed: true });
    const before = await getOnboarding();

    const after = await patchOnboarding({
      hostedIntroDone: true,
      hostedCoach: { session: true, schedule: true },
    });
    expect(after.steps).toEqual(before.steps);
    expect(after.completedAt).toBe(before.completedAt!);

    // ...and the reverse: restarting the hosted tour must not un-complete the
    // open-source flow.
    const reset = await patchOnboarding({ hostedIntroDone: false });
    expect(reset.steps).toEqual(before.steps);
    expect(reset.completedAt).toBe(before.completedAt!);
  });

  test("an onboarding.json written before this feature still loads", async () => {
    // Real upgrade path: every existing Computer has a file with no `hosted`
    // key. It must read as "has not seen it" rather than throwing the whole
    // state away — which would also wipe their profiles.
    writeFileSync(
      join(root, "onboarding.json"),
      JSON.stringify({
        profiles: [{ email: "a@b.com", name: "A", createdAt: new Date(0).toISOString() }],
        steps: { profile: true, agents: true, repo: true, firstSession: true },
        completedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const state = await getOnboarding();
    expect(state.profiles).toHaveLength(1);
    expect(state.completedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(state.hosted.introDoneAt).toBeNull();
  });

  test("a malformed hosted block falls back instead of throwing", async () => {
    writeFileSync(
      join(root, "onboarding.json"),
      JSON.stringify({ hosted: { introDoneAt: 42, coach: "nope" } }),
    );
    const state = await getOnboarding();
    expect(state.hosted).toEqual({ introDoneAt: null, coach: { session: false, schedule: false } });
  });
});
