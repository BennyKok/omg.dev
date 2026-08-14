import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindClaudeSessionAccount,
  claudeAccountConfigDir,
  claudeAccountIdForSession,
  connectedClaudeAccounts,
  createClaudeAccount,
  listClaudeAccounts,
  pickClaudeAccountForNewSession,
  removeClaudeAccount,
} from "./claude-accounts.ts";

describe("Claude account registry", () => {
  const originalHome = process.env.HOME;
  const originalStore = process.env.LFG_CLAUDE_ACCOUNTS_PATH;
  let root = "";

  function connect(configDir: string, token: string): void {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: token } }),
      { mode: 0o600 },
    );
  }

  /** A stored credential the CLI can never renew — the reconnect case. */
  function breakSignIn(configDir: string): void {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: { accessToken: "spent", expiresAt: Date.now() - 60_000 },
      }),
      { mode: 0o600 },
    );
  }

  function seed(): void {
    root = mkdtempSync(join(tmpdir(), "lfg-claude-accounts-"));
    process.env.HOME = join(root, "home");
    process.env.LFG_CLAUDE_ACCOUNTS_PATH = join(root, "data", "accounts.json");
  }

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalStore === undefined) delete process.env.LFG_CLAUDE_ACCOUNTS_PATH;
    else process.env.LFG_CLAUDE_ACCOUNTS_PATH = originalStore;
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  // The reported bug: with more than one account, signing out of (or breaking)
  // one made its row vanish, so the only control that could fix it was gone.
  test("a signed-out account stays listed so it can be reconnected", () => {
    seed();
    const second = createClaudeAccount();
    connect(claudeAccountConfigDir(second.id)!, "second-token");

    // Account 1 holds no credential — it is signed out, not unknown.
    expect(listClaudeAccounts()).toMatchObject([
      { id: "default", number: 1, connected: false, needsReconnect: false },
      { id: second.id, number: 2, connected: true },
    ]);
    expect(connectedClaudeAccounts().map((account) => account.number)).toEqual([2]);
  });

  test("an unrenewable credential reads as needing a reconnect, not as connected", () => {
    seed();
    connect(join(process.env.HOME!, ".claude"), "default-token");
    const second = createClaudeAccount();
    breakSignIn(claudeAccountConfigDir(second.id)!);

    expect(listClaudeAccounts()).toMatchObject([
      { number: 1, connected: true, needsReconnect: false },
      { number: 2, connected: false, needsReconnect: true },
    ]);
    // A dead account must not be routable, or auto would pick it and fail.
    expect(connectedClaudeAccounts().map((account) => account.number)).toEqual([1]);
  });

  test("a lone broken default account is still listed", () => {
    seed();
    breakSignIn(join(process.env.HOME!, ".claude"));

    expect(listClaudeAccounts()).toMatchObject([
      { id: "default", connected: false, needsReconnect: true },
    ]);
  });

  test("a machine that never connected Claude lists nothing", () => {
    seed();

    expect(listClaudeAccounts()).toEqual([]);
  });

  test("imports the existing Claude login as account 1 and adds isolated accounts", () => {
    root = mkdtempSync(join(tmpdir(), "lfg-claude-accounts-"));
    process.env.HOME = join(root, "home");
    process.env.LFG_CLAUDE_ACCOUNTS_PATH = join(root, "data", "accounts.json");
    connect(join(process.env.HOME, ".claude"), "default-token");

    expect(listClaudeAccounts()).toMatchObject([
      { id: "default", number: 1, label: "Claude 1", connected: true, removable: false },
    ]);

    const second = createClaudeAccount();
    expect(second).toMatchObject({ number: 2, label: "Claude 2", connected: false, removable: true });
    const secondDir = claudeAccountConfigDir(second.id)!;
    connect(secondDir, "second-token");

    expect(connectedClaudeAccounts().map((account) => account.number)).toEqual([1, 2]);
    bindClaudeSessionAccount("session-2", second.id);
    expect(claudeAccountIdForSession("session-2")).toBe(second.id);

    expect(removeClaudeAccount(second.id)).toBe(true);
    expect(existsSync(secondDir)).toBe(false);
    expect(claudeAccountIdForSession("session-2")).toBeNull();
  });

  test("auto picks the account with the most headroom in its tightest window", async () => {
    root = mkdtempSync(join(tmpdir(), "lfg-claude-accounts-"));
    process.env.HOME = join(root, "home");
    process.env.LFG_CLAUDE_ACCOUNTS_PATH = join(root, "data", "accounts.json");
    connect(join(process.env.HOME, ".claude"), "default-token");
    const second = createClaudeAccount();
    connect(claudeAccountConfigDir(second.id)!, "second-token");

    const picked = await pickClaudeAccountForNewSession({
      readCapacity: async (account) =>
        account.id === second.id
          ? { available: true, windows: [{ pct: 35 }, { pct: 40 }] }
          : { available: true, windows: [{ pct: 20 }, { pct: 80 }] },
    });

    expect(picked?.id).toBe(second.id);
  });

  test("explicit account pins bypass capacity routing", async () => {
    root = mkdtempSync(join(tmpdir(), "lfg-claude-accounts-"));
    process.env.HOME = join(root, "home");
    process.env.LFG_CLAUDE_ACCOUNTS_PATH = join(root, "data", "accounts.json");
    connect(join(process.env.HOME, ".claude"), "default-token");
    const second = createClaudeAccount();
    connect(claudeAccountConfigDir(second.id)!, "second-token");
    let reads = 0;

    const picked = await pickClaudeAccountForNewSession({
      explicitAccountId: second.id,
      readCapacity: async () => {
        reads++;
        return { available: true, windows: [{ pct: 100 }] };
      },
    });

    expect(picked?.id).toBe(second.id);
    expect(reads).toBe(0);
  });

  test("auto prefers unknown capacity to a known exhausted account", async () => {
    root = mkdtempSync(join(tmpdir(), "lfg-claude-accounts-"));
    process.env.HOME = join(root, "home");
    process.env.LFG_CLAUDE_ACCOUNTS_PATH = join(root, "data", "accounts.json");
    connect(join(process.env.HOME, ".claude"), "default-token");
    const second = createClaudeAccount();
    connect(claudeAccountConfigDir(second.id)!, "second-token");

    const picked = await pickClaudeAccountForNewSession({
      readCapacity: async (account) => {
        if (account.id === second.id) throw new Error("usage unavailable");
        return { available: true, windows: [{ pct: 100 }, { pct: 45 }] };
      },
    });

    expect(picked?.id).toBe(second.id);
  });

  test("auto breaks equal-capacity ties by stable account number", async () => {
    root = mkdtempSync(join(tmpdir(), "lfg-claude-accounts-"));
    process.env.HOME = join(root, "home");
    process.env.LFG_CLAUDE_ACCOUNTS_PATH = join(root, "data", "accounts.json");
    connect(join(process.env.HOME, ".claude"), "default-token");
    const second = createClaudeAccount();
    connect(claudeAccountConfigDir(second.id)!, "second-token");

    const picked = await pickClaudeAccountForNewSession({
      readCapacity: async () => ({
        available: true,
        windows: [{ pct: 30 }, { pct: 50 }],
      }),
    });

    expect(picked?.id).toBe("default");
  });
});
