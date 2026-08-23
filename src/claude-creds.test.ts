import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeOauthToken,
  claudeSignInIsDead,
  resetClaudeCredsCacheForTests,
} from "./claude-creds.ts";

describe("Claude account credentials", () => {
  const originalHome = process.env.HOME;
  let testHome = "";

  // Stand in for a machine with nothing in the Keychain. The real reader is not
  // scoped to $HOME, so on a macOS box where the maintainer is signed in to
  // Claude Code it answers with their live token and the "initial miss" below
  // can never hold — the suite passed only on Linux or a signed-out Mac.
  const noKeychain = () => null;

  beforeEach(() => {
    resetClaudeCredsCacheForTests();
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (testHome) rmSync(testHome, { recursive: true, force: true });
    testHome = "";
    resetClaudeCredsCacheForTests();
  });

  test("observes a browser login immediately after an initial miss", () => {
    testHome = mkdtempSync(join(tmpdir(), "lfg-claude-creds-"));
    process.env.HOME = testHome;
    expect(claudeOauthToken(undefined, noKeychain)).toBeNull();

    const credentialsDir = join(testHome, ".claude");
    mkdirSync(credentialsDir, { recursive: true });
    writeFileSync(
      join(credentialsDir, ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "oauth-test-token" } }),
    );

    expect(claudeOauthToken(undefined, noKeychain)).toBe("oauth-test-token");
  });

  test("prefers the credentials file over the Keychain", () => {
    testHome = mkdtempSync(join(tmpdir(), "lfg-claude-creds-"));
    process.env.HOME = testHome;
    mkdirSync(join(testHome, ".claude"), { recursive: true });
    writeFileSync(
      join(testHome, ".claude", ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "from-file" } }),
    );

    // Pins the ordering the comment in claudeOauthToken relies on: a login that
    // just landed in the file must win over a stale Keychain entry, otherwise
    // the 60s cache hides it until it expires.
    expect(
      claudeOauthToken(undefined, () => ({ claudeAiOauth: { accessToken: "from-keychain" } })),
    ).toBe("from-file");
  });

  // "Dead" has to mean unrecoverable, not merely expired: the Claude CLI renews
  // an expired access token from the refresh token on its next run, so calling
  // that state dead would tell every idle account to sign in again each morning.
  function writeCreds(oauth: Record<string, unknown>): void {
    testHome = testHome || mkdtempSync(join(tmpdir(), "lfg-claude-creds-"));
    process.env.HOME = testHome;
    mkdirSync(join(testHome, ".claude"), { recursive: true });
    writeFileSync(
      join(testHome, ".claude", ".credentials.json"),
      JSON.stringify({ claudeAiOauth: oauth }),
    );
  }

  test("an expired token with a refresh token is not a dead sign-in", () => {
    writeCreds({
      accessToken: "stale",
      refreshToken: "renewable",
      expiresAt: Date.now() - 60_000,
    });

    expect(claudeSignInIsDead(undefined, noKeychain)).toBe(false);
  });

  test("an expired token with no refresh token is a dead sign-in", () => {
    writeCreds({ accessToken: "stale", expiresAt: Date.now() - 60_000 });

    expect(claudeSignInIsDead(undefined, noKeychain)).toBe(true);
  });

  // What refreshFileToken writes after Anthropic answers 400 invalid_grant.
  function writeRejection(refreshToken: string) {
    writeFileSync(
      join(testHome, ".claude", ".credentials.lfg-refresh.json"),
      JSON.stringify({
        fingerprint: createHash("sha256").update(refreshToken).digest("hex").slice(0, 16),
        at: Date.now(),
        error: '{"error":"invalid_grant"}',
      }),
    );
  }

  test("a refresh token Anthropic already rejected is a dead sign-in", () => {
    writeCreds({
      accessToken: "stale",
      refreshToken: "revoked",
      expiresAt: Date.now() - 60_000,
    });
    writeRejection("revoked");

    // A present refresh token normally means "renewable". Once the server has
    // refused this exact one, only a browser sign-in revives the account.
    expect(claudeSignInIsDead(undefined, noKeychain)).toBe(true);
  });

  test("a rejection recorded for an older token does not condemn the new one", () => {
    writeCreds({
      accessToken: "stale",
      refreshToken: "current",
      expiresAt: Date.now() - 60_000,
    });
    writeRejection("previous");

    expect(claudeSignInIsDead(undefined, noKeychain)).toBe(false);
  });

  test("an account with no credential at all is not a dead sign-in", () => {
    testHome = mkdtempSync(join(tmpdir(), "lfg-claude-creds-"));
    process.env.HOME = testHome;

    // Nothing stored is "never connected", which the UI already renders as
    // Connect. Only a stored-but-unusable credential earns Reconnect.
    expect(claudeSignInIsDead(undefined, noKeychain)).toBe(false);
  });
});
