// Coding agents settings: collapsed copy is one word, and the expanded row
// is only the missing action — no check lists, command dumps, or OMG labels.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const window = new Window({ url: "https://app.omg.dev/" });
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  HTMLElement: window.HTMLElement,
  Element: window.Element,
  Node: window.Node,
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
});

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { default: CodingAgentsPage, agentStatusNote } = await import("./coding-agents-page");
import type { CodingAgentInfo } from "../App";

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (ui: React.ReactElement) => act(() => root.render(ui));

const noop = () => {};

function agent(partial: Partial<CodingAgentInfo> & Pick<CodingAgentInfo, "key" | "label">): CodingAgentInfo {
  return {
    visible: false,
    status: {
      configured: false,
      accountConnected: false,
      omgCapabilityAccess: "mcp",
      setupRunning: false,
      canAutoSetup: true,
      canLoginInTerminal: false,
      checks: [{ label: "Jcode CLI", ok: false, detail: "not found" }],
      instructions: ["Connect Claude or Codex above."],
      installCommand: "curl -fsSL https://jcode.sh/install | bash",
      loginCommand: "'jcode' login",
      ...partial.status,
    },
    ...partial,
    status: {
      configured: false,
      accountConnected: false,
      omgCapabilityAccess: "mcp",
      setupRunning: false,
      canAutoSetup: true,
      canLoginInTerminal: false,
      checks: [{ label: "Jcode CLI", ok: false, detail: "not found" }],
      instructions: ["Connect Claude or Codex above."],
      installCommand: "curl -fsSL https://jcode.sh/install | bash",
      loginCommand: "'jcode' login",
      ...partial.status,
    },
  };
}

function page(agents: CodingAgentInfo[], extras: Partial<Parameters<typeof CodingAgentsPage>[0]> = {}) {
  return (
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
      {...extras}
    />
  );
}

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

  test("says nothing when every check passed", () => {
    expect(agentStatusNote([{ label: "OpenCode CLI", ok: true }])).toBeNull();
  });
});

describe("CodingAgentsPage", () => {
  const jcodeMissingCli = agent({
    key: "jcode",
    label: "jcode",
    status: {
      configured: false,
      accountConnected: false,
      omgCapabilityAccess: "mcp",
      setupRunning: false,
      canAutoSetup: true,
      canLoginInTerminal: false,
      checks: [{ label: "Jcode CLI", ok: false, detail: "not found" }],
      instructions: ["Connect Claude or Codex above."],
      installCommand: "curl -fsSL https://jcode.sh/install | bash",
      providers: [
        { id: "claude", label: "Claude", method: "oauth", connected: false },
        { id: "openai", label: "Codex", method: "oauth", connected: false },
      ],
    },
  });

  test("a collapsed unready row shows one word and no red dot", () => {
    render(page([jcodeMissingCli]));
    expect(host.textContent).toContain("jcode");
    expect(host.textContent).toContain("Install");
    expect(host.textContent).not.toContain("Jcode CLI missing");
    expect(host.textContent).not.toContain("Jcode CLI not found");
    expect(host.textContent).not.toContain("checks failing");
    expect(host.querySelector(".bg-destructive")).toBeNull();
  });

  test("an expanded jcode row with a missing CLI is Connect plus Install", () => {
    render(page([jcodeMissingCli]));
    const toggle = [...host.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-expanded") === "false" && button.textContent?.includes("jcode"),
    );
    expect(toggle).toBeTruthy();
    act(() => toggle!.click());
    const text = host.textContent ?? "";
    expect(text).toContain("Claude");
    expect(text).toContain("Codex");
    expect(text).toContain("Connect");
    expect(text).toContain("Install");
    expect(text).not.toContain("Jcode CLI not found");
    expect(text).not.toContain("curl -fsSL");
    expect(text).not.toContain("OMG tools");
    expect(text).not.toContain("OMG prompt only");
    expect(text).not.toContain("Connect Claude or Codex above.");
    expect(text).not.toContain("'jcode' login");
  });

  test("turning an unready agent on expands setup instead of enabling it", () => {
    const changes: Array<{ kind: string; visible: boolean }> = [];
    render(
      page([jcodeMissingCli], {
        onVisibleChange: (kind, visible) => changes.push({ kind, visible }),
      }),
    );
    const sw = host.querySelector('[aria-label="jcode visible in composer"]') as HTMLElement | null;
    expect(sw).toBeTruthy();
    act(() => sw!.click());
    expect(changes).toEqual([]);
    expect(host.textContent).toContain("Claude");
    expect(host.textContent).toContain("Install");
  });

  test("jcode Connect with a missing CLI runs setup instead of the login dialog", () => {
    const setups: string[] = [];
    const connects: string[] = [];
    render(
      page([jcodeMissingCli], {
        onSetup: (kind) => setups.push(kind),
        onConnectProvider: (_kind, provider) => connects.push(provider.id),
      }),
    );
    const toggle = [...host.querySelectorAll("button")].find((button) =>
      button.getAttribute("aria-expanded") === "false" && button.textContent?.includes("jcode"),
    );
    act(() => toggle!.click());
    const connect = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Connect"));
    expect(connect).toBeTruthy();
    act(() => connect!.click());
    expect(setups).toEqual(["jcode"]);
    expect(connects).toEqual([]);
  });
});
