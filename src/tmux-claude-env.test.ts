import { describe, expect, test } from "bun:test";
import { claudeAccountLaunchCommand } from "./tmux.ts";

describe("Claude account launch environment", () => {
  test("keeps the platform provider environment when no account is connected", () => {
    const command = ["/home/user/.bun/bin/claude", "--model", "sonnet"];

    expect(claudeAccountLaunchCommand(command, false)).toBe(command);
  });

  test("removes every competing Anthropic source for a connected account", () => {
    const command = ["/home/user/.bun/bin/claude", "--model", "sonnet"];
    const argv = claudeAccountLaunchCommand(command, true);

    expect(argv[0]).toMatch(/\/env$/);
    expect(argv.slice(1)).toEqual([
      "-u",
      "ANTHROPIC_API_KEY",
      "-u",
      "ANTHROPIC_AUTH_TOKEN",
      "-u",
      "ANTHROPIC_BASE_URL",
      ...command,
    ]);
  });

  test("sets the isolated config directory for a selected account", () => {
    const command = ["claude", "--model", "opus"];
    const argv = claudeAccountLaunchCommand(command, true, "/data/claude/account-2");
    expect(argv.slice(-4)).toEqual([
      "CLAUDE_CONFIG_DIR=/data/claude/account-2",
      ...command,
    ]);
  });

  // CLAUDE_CODE_OAUTH_TOKEN is process-wide and outranks the config directory,
  // so an isolated account that inherited it would run on the wrong login.
  test("removes the environment token for an isolated account", () => {
    const argv = claudeAccountLaunchCommand(["claude"], true, "/data/claude/account-2");
    expect(argv).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(argv.indexOf("CLAUDE_CODE_OAUTH_TOKEN")).toBeGreaterThan(0);
    expect(argv[argv.indexOf("CLAUDE_CODE_OAUTH_TOKEN") - 1]).toBe("-u");
  });

  // The default account may BE the environment token. Unsetting it there would
  // delete the credential that made the account connected.
  test("keeps the environment token for the default account", () => {
    const argv = claudeAccountLaunchCommand(["claude"], true);
    expect(argv).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });
});
