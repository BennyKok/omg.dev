import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentAccountProfile,
  claudeAccountProfile,
  codexAccountProfile,
  cursorAccountProfile,
  grokAccountProfile,
} from "./agent-profiles.ts";

let home = "";
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "agent-profiles-"));
  process.env.HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

function write(relative: string, body: unknown): void {
  const path = join(home, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
}

/** A JWT this code only ever decodes for display, so the signature is filler. */
function idToken(claims: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `header.${body}.signature`;
}

test("no credential file yields no profile", () => {
  expect(codexAccountProfile()).toBeNull();
  expect(cursorAccountProfile()).toBeNull();
  expect(grokAccountProfile()).toBeNull();
  expect(claudeAccountProfile(join(home, ".claude"))).toBeNull();
});

test("codex reads the email and plan from the id token", () => {
  write(".codex/auth.json", {
    tokens: {
      id_token: idToken({
        email: "person@example.com",
        "https://api.openai.com/auth": { chatgpt_plan_type: "plus" },
      }),
    },
  });
  expect(codexAccountProfile()).toEqual({
    label: "person@example.com",
    detail: "Plus",
    source: "local-cli",
  });
});

test("codex falls back to the name claim when no email is present", () => {
  write(".codex/auth.json", { tokens: { id_token: idToken({ name: "Sam" }) } });
  expect(codexAccountProfile()).toEqual({ label: "Sam", source: "local-cli" });
});

// An OPENAI_API_KEY makes codex runnable, but auth.json then carries no user
// token. Reporting a profile here would name an account nobody signed in to.
test("codex reports nothing for an api-key-only auth file", () => {
  write(".codex/auth.json", { OPENAI_API_KEY: "sk-test", tokens: {} });
  expect(codexAccountProfile()).toBeNull();
});

test("a malformed id token does not throw", () => {
  write(".codex/auth.json", { tokens: { id_token: "not-a-jwt" } });
  expect(codexAccountProfile()).toBeNull();
});

test("unreadable json does not throw", () => {
  write(".codex/auth.json", "{ broken");
  expect(codexAccountProfile()).toBeNull();
});

test("cursor reads the signed-in email", () => {
  write(".cursor/cli-config.json", {
    authInfo: { email: "person@example.com", displayName: "A Person", userId: 42 },
  });
  expect(cursorAccountProfile()).toEqual({
    label: "person@example.com",
    source: "local-cli",
  });
});

test("cursor falls back to the display name", () => {
  write(".cursor/cli-config.json", { authInfo: { displayName: "A Person" } });
  expect(cursorAccountProfile()).toEqual({ label: "A Person", source: "local-cli" });
});

test("grok reads the entry that holds a key", () => {
  write(".grok/auth.json", {
    "https://auth.x.ai::stale": { email: "old@example.com" },
    "https://auth.x.ai::live": { key: "k", email: "person@example.com" },
  });
  expect(grokAccountProfile()).toEqual({ label: "person@example.com", source: "local-cli" });
});

// The connected check requires a non-empty key, so the profile must apply the
// same rule. Otherwise a signed-out machine still shows an address.
test("grok ignores entries with no key", () => {
  write(".grok/auth.json", { "https://auth.x.ai::stale": { email: "old@example.com" } });
  expect(grokAccountProfile()).toBeNull();
});

test("claude reads .claude.json beside the config directory", () => {
  write(".claude.json", {
    oauthAccount: { emailAddress: "person@example.com", organizationType: "claude_max" },
  });
  expect(claudeAccountProfile(join(home, ".claude"))).toEqual({
    label: "person@example.com",
    detail: "Max",
    source: "local-cli",
  });
});

// Extra accounts run with CLAUDE_CONFIG_DIR set, which moves .claude.json
// inside that directory. The nearer file must win, or every isolated account
// reports the default login's address.
test("claude prefers .claude.json inside the config directory", () => {
  write(".claude.json", { oauthAccount: { emailAddress: "default@example.com" } });
  write("accounts/one/.claude.json", { oauthAccount: { emailAddress: "second@example.com" } });
  expect(claudeAccountProfile(join(home, "accounts", "one"))?.label).toBe("second@example.com");
});

// The default account keeps its .claude.json one level up, beside ~/.claude,
// so the parent is a real fallback for that layout only.
test("claude finds the default account file beside its config directory", () => {
  write(".claude.json", { oauthAccount: { emailAddress: "default@example.com" } });
  expect(claudeAccountProfile(join(home, ".claude"))?.label).toBe("default@example.com");
});

// An isolated account directory that holds no .claude.json must report nothing.
// Falling back past it would label every extra account with whichever login
// happens to sit beside the accounts root.
test("an isolated account with no file does not inherit another login", () => {
  write(".claude.json", { oauthAccount: { emailAddress: "default@example.com" } });
  write("accounts/one/.claude.json", { oauthAccount: { emailAddress: "second@example.com" } });
  expect(claudeAccountProfile(join(home, "accounts", "two"))).toBeNull();
});

test("claude plan codes lose their vendor prefix", () => {
  write(".claude.json", {
    oauthAccount: { emailAddress: "a@example.com", organizationType: "claude_pro" },
  });
  expect(claudeAccountProfile(join(home, ".claude"))?.detail).toBe("Pro");
});

test("an account with no plan reports no detail", () => {
  write(".claude.json", { oauthAccount: { emailAddress: "a@example.com" } });
  expect(claudeAccountProfile(join(home, ".claude"))).toEqual({
    label: "a@example.com",
    source: "local-cli",
  });
});

test("blank identity fields are not treated as an account", () => {
  write(".cursor/cli-config.json", { authInfo: { email: "   ", displayName: "" } });
  expect(cursorAccountProfile()).toBeNull();
});

test("agentAccountProfile routes each kind to its own reader", () => {
  write(".codex/auth.json", { tokens: { id_token: idToken({ email: "codex@example.com" }) } });
  write(".cursor/cli-config.json", { authInfo: { email: "cursor@example.com" } });
  write(".grok/auth.json", { live: { key: "k", email: "grok@example.com" } });
  write(".claude.json", { oauthAccount: { emailAddress: "claude@example.com" } });

  expect(agentAccountProfile("codex")?.label).toBe("codex@example.com");
  expect(agentAccountProfile("codex-aisdk")?.label).toBe("codex@example.com");
  expect(agentAccountProfile("cursor")?.label).toBe("cursor@example.com");
  expect(agentAccountProfile("grok")?.label).toBe("grok@example.com");
  expect(agentAccountProfile("aisdk", join(home, ".claude"))?.label).toBe("claude@example.com");
});

// Claude is the one kind whose identity depends on which account directory the
// caller means, so it must not guess when nobody supplied one.
test("claude reports nothing without a config directory", () => {
  write(".claude.json", { oauthAccount: { emailAddress: "claude@example.com" } });
  expect(agentAccountProfile("aisdk")).toBeNull();
});

// Kinds that only ever hold an API key have no account to name.
test("api-key-only kinds have no profile", () => {
  expect(agentAccountProfile("deepseek")).toBeNull();
  expect(agentAccountProfile("opencode")).toBeNull();
  expect(agentAccountProfile("pi")).toBeNull();
  expect(agentAccountProfile("copilot")).toBeNull();
});
