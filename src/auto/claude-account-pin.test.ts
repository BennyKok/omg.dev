// Pinning a scheduled auto agent to a specific Claude account.
//
// Two things have to hold for the account chips in the auto-agent sheets to be
// honest rather than decorative:
//
//   1. the stored pin cannot outlive a switch to a backend that has no accounts
//      (the exact bug thinkingLevel already hit: a `??` merge resurrected a
//      field the new backend can't use, writing a row nothing re-validates)
//   2. clearing a pin has to actually clear it — an absent field means "leave
//      the stored pin alone" (the CLI and the refine endpoint save without one),
//      so if "cleared" and "not supplied" collapse to the same value the agent
//      keeps billing the account the user just un-pinned

import { expect, test } from "bun:test";
import { claudeAccountForBackend } from "./store.ts";

test("a pinned account survives on claude and on an old backend-less row", () => {
  expect(claudeAccountForBackend("acct-2", undefined, "aisdk")).toBe("acct-2");
  // undefined backend = a row saved before the field existed, which runs aisdk.
  expect(claudeAccountForBackend("acct-2", undefined, undefined)).toBe("acct-2");
});

test("a pinned account is dropped when the agent moves off claude", () => {
  for (const backend of ["codex-aisdk", "grok", "cursor", "opencode", "hermes"] as const) {
    expect(claudeAccountForBackend("acct-2", undefined, backend)).toBeUndefined();
  }
  // ...including when the pin is only the stored one and the save never mentions it.
  expect(claudeAccountForBackend(undefined, "acct-2", "grok")).toBeUndefined();
});

test("a save that never mentions the field keeps the stored pin", () => {
  // The CLI edit paths and the refine endpoint save this way.
  expect(claudeAccountForBackend(undefined, "acct-2", "aisdk")).toBe("acct-2");
});

test("an explicitly emptied field clears the stored pin", () => {
  // This is the whole bug: the editor omits an empty field and JSON.stringify
  // drops undefined, so picking "Claude · Auto" and saving used to be a no-op
  // that handed the old pin straight back.
  expect(claudeAccountForBackend(null, "acct-2", "aisdk")).toBeUndefined();
  expect(claudeAccountForBackend("", "acct-2", "aisdk")).toBeUndefined();
});

test("an explicit pin overrides the stored one", () => {
  expect(claudeAccountForBackend("acct-3", "acct-2", "aisdk")).toBe("acct-3");
});

test("no pin anywhere stays no pin", () => {
  expect(claudeAccountForBackend(undefined, undefined, "aisdk")).toBeUndefined();
  expect(claudeAccountForBackend("", undefined, "aisdk")).toBeUndefined();
});
