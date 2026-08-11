// The agent pickers and the server must agree on one roster.
//
// This is a regression test for a real UI break: the auto-agent sheets carried
// their own hardcoded copy of the agent list, so the finding sheet showed four
// icons while the composer next to it showed the full roster plus a chip per
// connected Claude account. Nothing failed loudly — the shorter list just
// looked like the whole truth.
//
// Two invariants keep that from coming back:
//   1. the schedulable subset of the client catalog IS the server's
//      AUTO_AGENT_BACKENDS — no more, no less
//   2. every catalog key is a real coding-agent kind the server knows about

import { expect, test } from "bun:test";
import { AGENT_CATALOG, scheduledAgentOptions } from "./coding-agent-options.ts";
import { AUTO_AGENT_BACKENDS } from "../../../src/agent-catalog.ts";
import { CODING_AGENT_KINDS } from "../../../src/coding-agents.ts";

test("the schedulable catalog subset matches the server's auto-agent backends", () => {
  expect(scheduledAgentOptions().map((option) => option.key).sort()).toEqual(
    [...AUTO_AGENT_BACKENDS].sort(),
  );
});

test("agents the runner cannot drive headless are offered for sessions but not schedules", () => {
  // pi, copilot, and jcode have no pipeTo* one-shot backend in src/agents/backends.
  // They must stay in the catalog (sessions can run them) and stay out of the
  // scheduled subset.
  const keys = AGENT_CATALOG.map((option) => option.key);
  const scheduled = scheduledAgentOptions().map((option) => option.key);
  for (const kind of ["pi", "copilot", "jcode"] as const) {
    expect(keys).toContain(kind);
    expect(scheduled).not.toContain(kind);
  }
});

test("every catalog entry is a coding-agent kind the server recognizes", () => {
  for (const option of AGENT_CATALOG) {
    expect(CODING_AGENT_KINDS).toContain(option.key);
  }
});

test("the catalog has no duplicate keys", () => {
  const keys = AGENT_CATALOG.map((option) => option.key);
  expect(new Set(keys).size).toBe(keys.length);
});
