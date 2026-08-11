import { describe, expect, test } from "bun:test";
import {
  AGENT_CATALOG,
  configuredAgentOptions,
  discoverableAgentKeys,
  lockedAgentOptions,
} from "../web/src/lib/coding-agent-options.ts";

const options = [
  { key: "aisdk", label: "claude" },
  { key: "codex-aisdk", label: "codex" },
  { key: "opencode", label: "opencode" },
];

describe("configuredAgentOptions", () => {
  test("keeps only visible, fully configured agents", () => {
    expect(configuredAgentOptions(options, [
      { key: "aisdk", visible: true, status: { configured: true } },
      { key: "codex-aisdk", visible: true, status: { configured: false } },
      { key: "opencode", visible: false, status: { configured: true } },
    ])).toEqual([{ key: "aisdk", label: "claude" }]);
  });

  test("does not fall back to unavailable agents", () => {
    expect(configuredAgentOptions(options, [
      { key: "aisdk", visible: true, status: { configured: false } },
    ])).toEqual([]);
  });

  test("preserves options only while availability data is loading", () => {
    expect(configuredAgentOptions(options)).toEqual(options);
  });

  test("offers only anonymous OpenCode on a hosted box without account auth", () => {
    expect(configuredAgentOptions(options, [
      { key: "aisdk", visible: true, status: { configured: true, accountConnected: false } },
      { key: "codex-aisdk", visible: true, status: { configured: true, accountConnected: false } },
      { key: "opencode", visible: true, status: { configured: true, accountConnected: false } },
    ], "connected-or-opencode")).toEqual([{ key: "opencode", label: "opencode" }]);
  });

  test("adds hosted agents only after their user-owned account is connected", () => {
    expect(configuredAgentOptions(options, [
      { key: "aisdk", visible: true, status: { configured: true, accountConnected: true } },
      { key: "codex-aisdk", visible: true, status: { configured: true, accountConnected: false } },
      { key: "opencode", visible: true, status: { configured: true, accountConnected: false } },
    ], "connected-or-opencode")).toEqual([
      { key: "aisdk", label: "claude" },
      { key: "opencode", label: "opencode" },
    ]);
  });

  test("does not flash account-backed agents while hosted availability loads", () => {
    expect(configuredAgentOptions(options, undefined, "connected-or-opencode")).toEqual([
      { key: "opencode", label: "opencode" },
    ]);
  });
});

describe("discoverableAgentKeys", () => {
  test("is the head of the shared catalog, so the two orders cannot disagree", () => {
    const keys = discoverableAgentKeys();
    expect(keys).toEqual(AGENT_CATALOG.slice(0, keys.length).map((entry) => entry.key));
  });

  test("is five wide — the strip has to fit on a phone", () => {
    expect(discoverableAgentKeys()).toHaveLength(5);
  });

  test("leads with the two agents most people already have accounts for", () => {
    expect(discoverableAgentKeys().slice(0, 2)).toEqual(["aisdk", "codex-aisdk"]);
  });
});

describe("lockedAgentOptions", () => {
  test("advertises the unconnected popular agents on a fresh hosted Computer", () => {
    // The exact case from the bug: a new Computer has anonymous OpenCode and
    // nothing else, so the picker used to be a single icon and Claude/Codex
    // were undiscoverable.
    expect(
      lockedAgentOptions(
        options,
        [
          { key: "aisdk", visible: true, status: { configured: true, accountConnected: false } },
          {
            key: "codex-aisdk",
            visible: true,
            status: { configured: true, accountConnected: false },
          },
          { key: "opencode", visible: true, status: { configured: true, accountConnected: false } },
        ],
        "connected-or-opencode",
      ),
    ).toEqual([
      { key: "aisdk", label: "claude" },
      { key: "codex-aisdk", label: "codex" },
    ]);
  });

  test("never locks an agent that is already launchable", () => {
    expect(
      lockedAgentOptions(
        options,
        [
          { key: "aisdk", visible: true, status: { configured: true, accountConnected: true } },
          {
            key: "codex-aisdk",
            visible: true,
            status: { configured: true, accountConnected: false },
          },
          { key: "opencode", visible: true, status: { configured: true, accountConnected: true } },
        ],
        "connected-or-opencode",
      ).map((option) => option.key),
    ).toEqual(["codex-aisdk"]);
  });

  test("respects an agent the person switched off in Settings", () => {
    expect(
      lockedAgentOptions(
        options,
        [
          { key: "aisdk", visible: false, status: { configured: true, accountConnected: false } },
          {
            key: "codex-aisdk",
            visible: true,
            status: { configured: true, accountConnected: false },
          },
          { key: "opencode", visible: true, status: { configured: true, accountConnected: false } },
        ],
        "connected-or-opencode",
      ).map((option) => option.key),
    ).toEqual(["codex-aisdk"]);
  });

  test("locks nothing on a self-hosted box, where every configured agent launches", () => {
    expect(
      lockedAgentOptions(options, [
        { key: "aisdk", visible: true, status: { configured: true } },
        { key: "codex-aisdk", visible: true, status: { configured: true } },
        { key: "opencode", visible: true, status: { configured: true } },
      ]),
    ).toEqual([]);
  });

  test("advertises nothing until the roster has actually arrived", () => {
    // `[]` is this app's real loading state — App seeds it and never passes
    // undefined. Reading it as "nothing is connected" would flash all five as
    // locked before every bootstrap, and would strand a signed-out demo
    // surface (empty collections by design) on five agents it cannot connect.
    for (const loading of [undefined, []]) {
      expect(lockedAgentOptions(options, loading, "connected-or-opencode")).toEqual([]);
      expect(lockedAgentOptions(options, loading)).toEqual([]);
    }
  });

  test("keeps agents outside the discoverable head hidden until connected", () => {
    const catalogOptions = AGENT_CATALOG.map((entry) => ({ key: entry.key, label: entry.label }));
    const locked = lockedAgentOptions(
      catalogOptions,
      AGENT_CATALOG.map((entry) => ({
        key: entry.key,
        visible: true,
        status: { configured: true, accountConnected: false },
      })),
      "connected-or-opencode",
    ).map((option) => option.key);
    expect(locked).not.toContain("pi");
    expect(locked).not.toContain("copilot");
    expect(locked).not.toContain("jcode");
  });
});
