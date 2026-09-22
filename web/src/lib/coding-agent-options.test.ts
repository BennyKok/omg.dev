import { describe, expect, test } from "bun:test";
import { reconcileSelectedAgent, resolveInitialAgent } from "./coding-agent-options";

describe("resolveInitialAgent", () => {
  test("uses the host default when no saved agent exists", () => {
    expect(resolveInitialAgent(null, "opencode")).toBe("opencode");
  });

  test("keeps a valid saved selection", () => {
    expect(resolveInitialAgent("codex-aisdk", "opencode")).toBe("codex-aisdk");
  });

  test("rejects an invalid saved selection", () => {
    expect(resolveInitialAgent("managed-anthropic", "opencode")).toBe("opencode");
  });
});

test("omg is selectable and keeps its saved kind", async () => {
  const { AGENT_CATALOG, configuredAgentOptions } = await import("./coding-agent-options");
  expect(AGENT_CATALOG.find((item) => item.key === "omg")).toEqual({ key: "omg", label: "omg agent", scheduled: true });
  expect(resolveInitialAgent("omg", "opencode")).toBe("omg");
  expect(configuredAgentOptions(AGENT_CATALOG, [{ key: "omg", visible: true, status: { configured: true, accountConnected: true } }], "connected-or-hosted").map((item) => item.key)).toEqual(["omg"]);
});

describe("the hosted access gate", () => {
  // Hosted surfaces cannot count the runtime's own proxy keys as user-owned
  // access, so an agent normally has to carry a connected account. The two
  // exemptions are the agents that need no credential of their own.
  test("offers the omg managed agent before its account reads connected", async () => {
    const { AGENT_CATALOG, configuredAgentOptions } = await import("./coding-agent-options");
    const roster = [
      { key: "omg", visible: true, status: { configured: true, accountConnected: false } },
      { key: "aisdk", visible: true, status: { configured: true, accountConnected: false } },
    ];
    expect(
      configuredAgentOptions(AGENT_CATALOG, roster, "connected-or-hosted").map((item) => item.key),
    ).toEqual(["omg"]);
  });

  test("does not offer OpenCode until the owner switches it on", async () => {
    const { AGENT_CATALOG, configuredAgentOptions } = await import("./coding-agent-options");
    // `visible: false` is what a ready-but-not-enabled OpenCode looks like now
    // (see OPT_IN_AGENT_KINDS in src/coding-agents.ts). It used to be the one
    // kind a hosted box always offered, which is how a saved omg selection got
    // replaced by OpenCode and its deepseek default.
    const off = [{ key: "opencode", visible: false, status: { configured: true, accountConnected: false } }];
    expect(configuredAgentOptions(AGENT_CATALOG, off, "connected-or-hosted")).toEqual([]);
    const on = [{ key: "opencode", visible: true, status: { configured: true, accountConnected: false } }];
    expect(
      configuredAgentOptions(AGENT_CATALOG, on, "connected-or-hosted").map((item) => item.key),
    ).toEqual(["opencode"]);
  });

  test("a roster that has not arrived narrows to the credential-free agents", async () => {
    const { AGENT_CATALOG, configuredAgentOptions } = await import("./coding-agent-options");
    expect(
      configuredAgentOptions(AGENT_CATALOG, undefined, "connected-or-hosted").map((item) => item.key),
    ).toEqual(["omg", "opencode"]);
  });
});

describe("knownAgentKind", () => {
  // The primitive that lets a caller try several saved sources in order
  // without each miss collapsing into the final fallback.
  test("names a catalog key, or nothing at all", async () => {
    const { knownAgentKind } = await import("./coding-agent-options");
    expect(knownAgentKind("omg")).toBe("omg");
    expect(knownAgentKind("managed-anthropic")).toBe(null);
    expect(knownAgentKind("")).toBe(null);
    expect(knownAgentKind(null)).toBe(null);
    expect(knownAgentKind(undefined)).toBe(null);
  });
});

describe("reconcileSelectedAgent", () => {
  const roster = [{ key: "omg" }, { key: "aisdk" }];

  test("leaves the selection alone while the roster is still empty", () => {
    // The bug this whole function exists for: an empty roster is the loading
    // state, and treating it as "your agent is gone" is what moved people off
    // the agent they picked on every cold load.
    expect(reconcileSelectedAgent([], "omg", "omg", "aisdk")).toBe(null);
  });

  test("leaves a launchable selection alone", () => {
    expect(reconcileSelectedAgent(roster, "omg", "omg", "aisdk")).toBe(null);
  });

  test("restores the chosen agent as soon as it can run again", () => {
    // omg dropped out for a moment, the composer substituted, and now omg is
    // back. The choice returns on its own rather than needing another tap.
    expect(reconcileSelectedAgent(roster, "aisdk", "omg", "aisdk")).toBe("omg");
  });

  test("substitutes onto the box default before the head of the list", () => {
    // "First in the list" is an ordering accident. The box default is a
    // decision someone made.
    expect(reconcileSelectedAgent(roster, "cursor", "cursor", "aisdk")).toBe("aisdk");
  });

  test("falls back to the first option when nothing else fits", () => {
    expect(reconcileSelectedAgent(roster, "cursor", "cursor", "devin")).toBe("omg");
  });

  test("reports no change rather than the value already selected", () => {
    expect(reconcileSelectedAgent([{ key: "omg" }], "omg", "cursor", "devin")).toBe(null);
  });
});
