// The harness installs the DOM globals, so it must be imported before the
// component. See web/src/test-support/render.tsx.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { agentStatusNote } from "../lib/coding-agent-status-note";
import type { CodingAgentInfo } from "../App";

const { default: CodingAgentsPage } = await import("./coding-agents-page");

describe("agentStatusNote", () => {
  test("says Install when the binary is missing", () => {
    expect(agentStatusNote([{ label: "Jcode CLI", ok: false }])).toBe("Install");
    expect(
      agentStatusNote([
        { label: "Jcode CLI", ok: false },
        { label: "Jcode provider", ok: false },
      ]),
    ).toBe("Install");
  });

  test("says Connect when the binary is present and auth is not", () => {
    expect(
      agentStatusNote([
        { label: "GitHub Copilot CLI", ok: true },
        { label: "Copilot auth", ok: false },
      ]),
    ).toBe("Connect");
    expect(
      agentStatusNote([
        { label: "pi runtime", ok: true },
        { label: "pi auth", ok: false },
      ]),
    ).toBe("Connect");
  });

  test("says nothing when every check passed and no account is named", () => {
    expect(agentStatusNote([{ label: "OpenCode CLI", ok: true }])).toBeNull();
  });

  test("names the signed-in account once the agent is ready", () => {
    expect(
      agentStatusNote([{ label: "Codex CLI", ok: true }], { label: "person@example.com" }),
    ).toBe("person@example.com");
  });

  test("summarises a multi-login agent by count instead of one address", () => {
    expect(agentStatusNote([{ label: "Claude CLI", ok: true }], { label: "a@example.com" }, 3)).toBe(
      "3 accounts",
    );
  });

  // One account has nothing to disambiguate, so the address is more useful
  // than "1 accounts".
  test("a single connected account still shows its address", () => {
    expect(agentStatusNote([{ label: "Claude CLI", ok: true }], { label: "a@example.com" }, 1)).toBe(
      "a@example.com",
    );
  });

  // An unready agent needs the action word, not a stale identity: a machine
  // whose CLI was uninstalled still has the old credential file on disk.
  test("an unready agent keeps its action word even with a profile", () => {
    expect(agentStatusNote([{ label: "Codex CLI", ok: false }], { label: "person@example.com" })).toBe(
      "Install",
    );
    expect(
      agentStatusNote(
        [
          { label: "Codex CLI", ok: true },
          { label: "Codex auth", ok: false },
        ],
        { label: "person@example.com" },
      ),
    ).toBe("Connect");
  });
});

function agent(overrides: Partial<CodingAgentInfo> = {}): CodingAgentInfo {
  const status = {
    configured: true,
    accountConnected: true,
    omgCapabilityAccess: "mcp" as const,
    setupRunning: false,
    canAutoSetup: true,
    canLoginInTerminal: true,
    checks: [{ label: "Codex CLI", ok: true }],
    instructions: [],
    ...(overrides.status ?? {}),
  };
  return {
    key: "codex-aisdk",
    label: "codex",
    visible: true,
    ...overrides,
    status,
  } as CodingAgentInfo;
}

const noop = () => {};

function renderPage(ui: Mounted, agents: CodingAgentInfo[]) {
  ui.render(
    <CodingAgentsPage
      setupChecks={[]}
      agents={agents}
      onVisibleChange={noop}
      onSetup={noop}
      onLogin={noop}
      onAddClaudeAccount={noop}
      onRemoveClaudeAccount={noop}
      onConnectProvider={noop}
      onDisconnectProvider={noop}
      onSetupCheck={noop}
      onRefresh={noop}
      computerMcpEnabled={false}
      onComputerMcpChange={noop}
    />,
  );
}

describe("CodingAgentsPage", () => {
  let ui: Mounted;
  beforeEach(() => {
    ui = mount();
  });
  afterEach(() => ui.cleanup());

  test("a collapsed ready row names the detected account", () => {
    renderPage(ui, [
      agent({ status: { profile: { label: "person@example.com", source: "local-cli" } } as never }),
    ]);
    expect(ui.text()).toContain("person@example.com");
  });

  test("a collapsed row with no detected account says nothing extra", () => {
    renderPage(ui, [agent()]);
    const text = ui.text();
    expect(text).toContain("codex");
    expect(text).not.toContain("Install");
    expect(text).not.toContain("Connect");
  });

  test("an agent that cannot run still shows the action word", () => {
    renderPage(ui, [
      agent({
        status: {
          configured: false,
          checks: [{ label: "Codex CLI", ok: false }],
          profile: { label: "person@example.com", source: "local-cli" },
        } as never,
      }),
    ]);
    expect(ui.text()).toContain("Install");
  });

  // "Claude 1" is synthetic ordering. Two accounts are indistinguishable
  // without the address behind each one, which is the whole job of the list.
  test("each Claude account row shows the login it uses", () => {
    renderPage(ui, [
      agent({
        key: "aisdk",
        label: "claude",
        status: {
          checks: [{ label: "Claude CLI", ok: true }],
          accounts: [
            {
              id: "default",
              number: 1,
              label: "Claude 1",
              profile: { label: "first@example.com", detail: "Max", source: "local-cli" },
              connected: true,
              removable: false,
              createdAt: 0,
            },
            {
              id: "second",
              number: 2,
              label: "Claude 2",
              profile: { label: "second@example.com", source: "local-cli" },
              connected: true,
              removable: true,
              createdAt: 1,
            },
          ],
        } as never,
      }),
    ]);
    // The rows are inside the collapsed section, so open it first.
    ui.flush(() => {
      const row = ui.queryAll("button").find((b) => b.textContent?.includes("claude"));
      row?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    const text = ui.text();
    expect(text).toContain("first@example.com");
    expect(text).toContain("second@example.com");
    // The plan rides along with the address rather than taking its own row.
    expect(text).toContain("Max");
    // The header summarises rather than picking a winner among the three.
    expect(text).toContain("2 accounts");
  });

  test("an account with no detected login still renders its row", () => {
    renderPage(ui, [
      agent({
        key: "aisdk",
        label: "claude",
        status: {
          checks: [{ label: "Claude CLI", ok: true }],
          accounts: [
            {
              id: "default",
              number: 1,
              label: "Claude 1",
              connected: true,
              removable: false,
              createdAt: 0,
            },
          ],
        } as never,
      }),
    ]);
    ui.flush(() => {
      const row = ui.queryAll("button").find((b) => b.textContent?.includes("claude"));
      row?.dispatchEvent(new Event("click", { bubbles: true }));
    });
    expect(ui.text()).toContain("Claude 1");
  });
});
