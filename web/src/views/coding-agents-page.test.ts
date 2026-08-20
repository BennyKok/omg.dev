import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { agentStatusNote } from "../lib/coding-agent-status-note";

const page = readFileSync(new URL("./coding-agents-page.tsx", import.meta.url), "utf8");

function agentRowBody(source: string): string {
  const start = source.indexOf("{agents.map((agent) => {");
  expect(start, "agent list was not found").toBeGreaterThanOrEqual(0);
  return source.slice(start);
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

describe("CodingAgentsPage copy cut", () => {
  test("collapsed agent rows use Install/Connect and never a red dot", () => {
    const row = agentRowBody(page);
    expect(row).toContain("note={agentStatusNote(status.checks)}");
    expect(row).toContain("showDot={false}");
    expect(row).not.toContain("statusNote(status.checks)");
  });

  test("the expanded agent row does not render dumps, check lists, or OMG tools", () => {
    const row = agentRowBody(page);
    expect(row).not.toContain("<CheckList");
    expect(row).not.toContain("status.instructions");
    expect(row).not.toContain("status.installCommand");
    expect(row).not.toContain("status.loginCommand &&");
    expect(row).not.toContain("OMG tools");
    expect(row).not.toContain("OMG prompt only");
    expect(row).toContain("status.providers");
    expect(row).toContain("canAutoSetup && needsBinary");
    expect(row).toContain("canLoginInTerminal && !hasProviderOrAccountRows");
  });

  test("turning an unready agent on expands setup instead of enabling it", () => {
    const row = agentRowBody(page);
    expect(row).toContain("if (visible && !status.configured)");
    expect(row).toContain("setExpanded(`agent:${agent.key}`)");
    const expandAt = row.indexOf("if (visible && !status.configured)");
    const saveAt = row.indexOf("onVisibleChange(agent.key, visible)");
    expect(expandAt).toBeGreaterThan(-1);
    expect(saveAt).toBeGreaterThan(expandAt);
  });

  test("expanded jcode is Claude/Codex Connect plus one Install", () => {
    const row = agentRowBody(page);
    expect(row).toContain("status.providers");
    expect(row).toContain('agent.key === "jcode" && needsBinary');
    expect(row).toContain("canAutoSetup && needsBinary");
    expect(row).not.toContain("<CheckList");
    expect(row).not.toContain("curl");
    expect(row).not.toContain("OMG tools");
  });

  test("jcode Connect with a missing CLI runs setup instead of the login dialog", () => {
    const row = agentRowBody(page);
    expect(row).toContain('agent.key === "jcode" && needsBinary');
    expect(row).toContain("onSetup(agent.key)");
    const setupAt = row.indexOf('agent.key === "jcode" && needsBinary');
    const connectAt = row.indexOf("onConnectProvider(agent.key, p)");
    expect(setupAt).toBeGreaterThan(-1);
    expect(connectAt).toBeGreaterThan(setupAt);
  });
});
