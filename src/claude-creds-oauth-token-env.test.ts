import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_ENV_TOKEN_KEY,
  claudeAccessToken,
  claudeAccountEnv,
  claudeAccountUsesEnvToken,
  claudeOauthToken,
  claudeSignInIsDead,
  resetClaudeCredsCacheForTests,
} from "./claude-creds.ts";

// CLAUDE_CODE_OAUTH_TOKEN is what `claude setup-token` prints. The CLI accepts
// it as a login, so LFG has to report the same account the CLI would use.
describe("CLAUDE_CODE_OAUTH_TOKEN as a connected account", () => {
  const originalHome = process.env.HOME;
  const originalToken = process.env[CLAUDE_ENV_TOKEN_KEY];
  let testHome = "";

  // The real Keychain reader is not scoped to $HOME, so a signed-in macOS
  // maintainer would otherwise see their own token in every assertion here.
  const noKeychain = () => null;

  const writeStoredLogin = (dir: string, accessToken: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken,
          refreshToken: "stored-refresh",
          expiresAt: Date.now() + 3_600_000,
        },
      }),
    );
  };

  beforeEach(() => {
    resetClaudeCredsCacheForTests();
    testHome = mkdtempSync(join(tmpdir(), "lfg-claude-env-token-"));
    process.env.HOME = testHome;
    delete process.env[CLAUDE_ENV_TOKEN_KEY];
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalToken === undefined) delete process.env[CLAUDE_ENV_TOKEN_KEY];
    else process.env[CLAUDE_ENV_TOKEN_KEY] = originalToken;
    if (testHome) rmSync(testHome, { recursive: true, force: true });
    testHome = "";
    resetClaudeCredsCacheForTests();
  });

  test("an empty box with the variable set reports a connected account", () => {
    expect(claudeOauthToken(undefined, noKeychain)).toBeNull();
    process.env[CLAUDE_ENV_TOKEN_KEY] = "sk-ant-oat01-from-env";
    expect(claudeOauthToken(undefined, noKeychain)).toBe("sk-ant-oat01-from-env");
    expect(claudeAccountUsesEnvToken()).toBe(true);
  });

  test("whitespace alone is not a credential", () => {
    process.env[CLAUDE_ENV_TOKEN_KEY] = "   ";
    expect(claudeOauthToken(undefined, noKeychain)).toBeNull();
    expect(claudeAccountUsesEnvToken()).toBe(false);
  });

  test("the variable outranks a stored login, as it does for the CLI itself", () => {
    writeStoredLogin(join(testHome, ".claude"), "from-file");
    expect(claudeOauthToken(undefined, noKeychain)).toBe("from-file");
    process.env[CLAUDE_ENV_TOKEN_KEY] = "from-env";
    expect(claudeOauthToken(undefined, noKeychain)).toBe("from-env");
  });

  test("an env-backed account is never reported as a dead sign-in", () => {
    process.env[CLAUDE_ENV_TOKEN_KEY] = "from-env";
    expect(claudeSignInIsDead(undefined, noKeychain)).toBe(false);
  });

  test("an isolated account ignores the process-wide variable", () => {
    const isolated = join(testHome, "accounts", "account-2");
    mkdirSync(isolated, { recursive: true });
    process.env[CLAUDE_ENV_TOKEN_KEY] = "from-env";
    expect(claudeOauthToken(isolated, noKeychain)).toBeNull();
    expect(claudeAccountUsesEnvToken(isolated)).toBe(false);
  });

  test("the usage token comes from the variable with no refresh attempt", async () => {
    process.env[CLAUDE_ENV_TOKEN_KEY] = "from-env";
    expect(await claudeAccessToken()).toBe("from-env");
  });
});

describe("claudeAccountEnv and the environment token", () => {
  const original = process.env[CLAUDE_ENV_TOKEN_KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[CLAUDE_ENV_TOKEN_KEY];
    else process.env[CLAUDE_ENV_TOKEN_KEY] = original;
  });

  test("the default account keeps the variable, because it may be the credential", () => {
    const env = claudeAccountEnv(
      { PATH: "/usr/bin", [CLAUDE_ENV_TOKEN_KEY]: "from-env", ANTHROPIC_API_KEY: "platform" },
      true,
    );
    expect(env).toEqual({ PATH: "/usr/bin", [CLAUDE_ENV_TOKEN_KEY]: "from-env" });
  });

  test("an isolated account drops the variable, or every account bills to one login", () => {
    const env = claudeAccountEnv(
      { PATH: "/usr/bin", [CLAUDE_ENV_TOKEN_KEY]: "from-env" },
      true,
      "/data/claude/account-2",
    );
    expect(env).toEqual({ PATH: "/usr/bin", CLAUDE_CONFIG_DIR: "/data/claude/account-2" });
  });
});
