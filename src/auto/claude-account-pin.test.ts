// Pinning a scheduled auto agent to a specific Claude account.
//
// Two things have to hold for the account chips in the auto-agent sheets to be
// honest rather than decorative:
//
//   1. the stored pin cannot outlive a switch to a backend that has no accounts
//      (the exact bug thinkingLevel already hit: a `??` merge resurrected a
//      field the new backend can't use, writing a row nothing re-validates)
//   2. the runner's env swap has to REPLACE the environment and put every last
//      variable back afterwards — it mutates the shared serve process, so a
//      leaked CLAUDE_CONFIG_DIR would silently re-bill every later run

import { expect, test } from "bun:test";
import { claudeAccountForBackend } from "./store.ts";
import { withProcessEnv } from "./cwd-lock.ts";

test("a pinned account survives on claude and on an old backend-less row", () => {
  expect(claudeAccountForBackend("acct-2", "aisdk")).toBe("acct-2");
  // undefined backend = a row saved before the field existed, which runs aisdk.
  expect(claudeAccountForBackend("acct-2", undefined)).toBe("acct-2");
});

test("a pinned account is dropped when the agent moves off claude", () => {
  for (const backend of ["codex-aisdk", "grok", "cursor", "opencode", "hermes"] as const) {
    expect(claudeAccountForBackend("acct-2", backend)).toBeUndefined();
  }
});

test("no pin stays no pin", () => {
  expect(claudeAccountForBackend(undefined, "aisdk")).toBeUndefined();
  expect(claudeAccountForBackend("", "aisdk")).toBeUndefined();
});

test("withProcessEnv replaces the environment and restores it exactly", async () => {
  process.env.LFG_PIN_TEST_KEEP = "original";
  delete process.env.LFG_PIN_TEST_ADDED;
  process.env.LFG_PIN_TEST_DROPPED = "platform-token";

  const seen = await withProcessEnv(
    { LFG_PIN_TEST_KEEP: "swapped", LFG_PIN_TEST_ADDED: "new" },
    async () => ({
      keep: process.env.LFG_PIN_TEST_KEEP,
      added: process.env.LFG_PIN_TEST_ADDED,
      // Keys absent from the replacement env must be GONE during the run —
      // that's the whole point: the account env drops the platform auth
      // variables that would otherwise override the account's credentials.
      dropped: process.env.LFG_PIN_TEST_DROPPED,
    }),
  );

  expect(seen).toEqual({ keep: "swapped", added: "new", dropped: undefined });
  expect(process.env.LFG_PIN_TEST_KEEP).toBe("original");
  expect(process.env.LFG_PIN_TEST_DROPPED).toBe("platform-token");
  expect(process.env.LFG_PIN_TEST_ADDED).toBeUndefined();

  delete process.env.LFG_PIN_TEST_KEEP;
  delete process.env.LFG_PIN_TEST_DROPPED;
});

test("withProcessEnv restores the environment even when the run throws", async () => {
  process.env.LFG_PIN_TEST_KEEP = "original";
  await expect(
    withProcessEnv({ LFG_PIN_TEST_KEEP: "swapped" }, async () => {
      throw new Error("run failed");
    }),
  ).rejects.toThrow("run failed");
  expect(process.env.LFG_PIN_TEST_KEEP).toBe("original");
  delete process.env.LFG_PIN_TEST_KEEP;
});

test("no account env means the process environment is left completely alone", async () => {
  process.env.LFG_PIN_TEST_KEEP = "original";
  const seen = await withProcessEnv(undefined, async () => process.env.LFG_PIN_TEST_KEEP);
  expect(seen).toBe("original");
  expect(process.env.LFG_PIN_TEST_KEEP).toBe("original");
  delete process.env.LFG_PIN_TEST_KEEP;
});
