import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteJcodeCredential,
  isJcodeAuthProviderId,
  jcodeAuthProviders,
  jcodeCliProviderFlag,
  jcodeCompleteArgv,
  jcodeCompleteFlag,
  jcodeLoginArgv,
  jcodeProviderLabel,
  parseJcodeAuthPrompt,
  summarizeJcodeAuthStatus,
} from "./jcode-auth.ts";

const savedEnv: Record<string, string | undefined> = {};
let tmpHome = "";

function setEnv(key: string, value: string | undefined) {
  savedEnv[key] ??= process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function useTmpHome() {
  tmpHome = mkdtempSync(join(tmpdir(), "jcode-auth-"));
  setEnv("HOME", tmpHome);
  setEnv("JCODE_HOME", undefined);
  setEnv("ANTHROPIC_API_KEY", undefined);
  setEnv("OPENAI_API_KEY", undefined);
  return tmpHome;
}

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete savedEnv[key];
  }
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  tmpHome = "";
});

describe("jcode provider ids", () => {
  test("Codex is the openai CLI flag, not --provider codex", () => {
    expect(jcodeCliProviderFlag("openai")).toBe("openai");
    expect(jcodeProviderLabel("openai")).toBe("Codex");
    expect(jcodeProviderLabel("claude")).toBe("Claude");
    expect(isJcodeAuthProviderId("claude")).toBe(true);
    expect(isJcodeAuthProviderId("openai")).toBe(true);
    expect(isJcodeAuthProviderId("codex")).toBe(false);
  });

  test("login argv uses the scriptable print-auth-url JSON flow", () => {
    expect(jcodeLoginArgv("/bin/jcode", "claude")).toEqual([
      "/bin/jcode",
      "--no-update",
      "login",
      "--provider",
      "claude",
      "--print-auth-url",
      "--json",
    ]);
    expect(jcodeLoginArgv("/bin/jcode", "openai")).toEqual([
      "/bin/jcode",
      "--no-update",
      "login",
      "--provider",
      "openai",
      "--print-auth-url",
      "--json",
    ]);
  });

  test("Claude completion picks --auth-code or --callback-url from the paste", () => {
    expect(jcodeCompleteFlag("claude", "abc123")).toBe("--auth-code");
    expect(jcodeCompleteFlag("claude", "https://claude.ai/callback?code=abc")).toBe("--callback-url");
    expect(jcodeCompleteArgv("/bin/jcode", "claude", "abc123")).toEqual([
      "/bin/jcode",
      "--no-update",
      "login",
      "--provider",
      "claude",
      "--auth-code",
      "abc123",
    ]);
  });

  test("Codex completion always sends --callback-url", () => {
    expect(jcodeCompleteFlag("openai", "https://localhost:1455/auth/callback?code=x")).toBe(
      "--callback-url",
    );
    expect(jcodeCompleteFlag("openai", "just-a-code")).toBe("--callback-url");
  });
});

describe("parseJcodeAuthPrompt", () => {
  test("reads the documented --json pending prompt", () => {
    const prompt = {
      status: "pending",
      provider: "claude",
      auth_url: "https://claude.ai/cai/oauth/authorize?code=true&state=abc",
      input_kind: "auth_code_or_callback_url",
      pending_path: "/tmp/pending-login/claude.json",
      user_code: null,
      expires_at_ms: 1_700_000_000_000,
      resume_command: "jcode login --provider claude --auth-code ' '",
    };

    expect(parseJcodeAuthPrompt(JSON.stringify(prompt))).toEqual({
      authorizationUrl: "https://claude.ai/cai/oauth/authorize?code=true&state=abc",
      inputKind: "auth_code_or_callback_url",
      expiresAtMs: 1_700_000_000_000,
    });
  });

  test("reads a Codex device-style user_code when present", () => {
    const prompt = {
      status: "pending",
      provider: "openai",
      auth_url: "https://auth.openai.com/authorize?client_id=x",
      input_kind: "callback_url",
      user_code: "42DX-1KQLE",
    };

    expect(parseJcodeAuthPrompt(`noise\n${JSON.stringify(prompt)}\n`)).toEqual({
      authorizationUrl: "https://auth.openai.com/authorize?client_id=x",
      userCode: "42DX-1KQLE",
      inputKind: "callback_url",
    });
  });

  test("falls back to the first https URL when JSON is absent", () => {
    expect(parseJcodeAuthPrompt("Open https://example.test/oauth then paste the callback")).toEqual({
      authorizationUrl: "https://example.test/oauth",
    });
  });

  test("returns null when nothing usable was printed", () => {
    expect(parseJcodeAuthPrompt("waiting...\n")).toBeNull();
  });
});

describe("jcode provider rows", () => {
  test("Claude and Codex rows exist before any login", () => {
    useTmpHome();
    const providers = jcodeAuthProviders(null);
    expect(providers.map((provider) => provider.id)).toEqual(["claude", "openai"]);
    expect(providers.every((provider) => provider.method === "oauth" && !provider.connected)).toBe(
      true,
    );
  });

  test("a jcode-managed file marks that provider connected and disconnectable", () => {
    const home = useTmpHome();
    mkdirSync(join(home, ".jcode"), { recursive: true });
    writeFileSync(join(home, ".jcode", "auth.json"), JSON.stringify({ accessToken: "tok" }));
    const claude = jcodeAuthProviders(null).find((provider) => provider.id === "claude");
    expect(claude?.connected).toBe(true);
    expect(claude?.fromEnv).toBeUndefined();
  });

  test("auth status JSON is the source of truth when it names a provider", () => {
    useTmpHome();
    const providers = jcodeAuthProviders({
      any_available: true,
      providers: [
        { id: "claude", status: "available", credential_source: "jcode-managed file" },
        { id: "openai", status: "available", credential_source: "none" },
      ],
    });
    expect(providers.find((provider) => provider.id === "claude")?.connected).toBe(true);
    expect(providers.find((provider) => provider.id === "openai")?.connected).toBe(false);
  });

  test("a credential jcode reports as unusable is not connected", () => {
    const home = useTmpHome();
    mkdirSync(join(home, ".jcode"), { recursive: true });
    // A revoked login leaves auth.json exactly as large as a working one, so
    // the file cannot be the signal. jcode just tried to refresh it and failed.
    writeFileSync(join(home, ".jcode", "auth.json"), JSON.stringify({ accessToken: "revoked" }));
    const claude = jcodeAuthProviders({
      any_available: true,
      providers: [
        { id: "claude", status: "expired", credential_source: "jcode-managed file" },
        { id: "openai", status: "available", credential_source: "jcode-managed file" },
      ],
    }).find((provider) => provider.id === "claude");
    expect(claude?.connected).toBe(false);
    expect(claude?.needsReconnect).toBe(true);
  });

  test("a provider jcode never configured stays a plain Connect row", () => {
    useTmpHome();
    const claude = jcodeAuthProviders({
      providers: [{ id: "claude", status: "not_configured", credential_source: "none" }],
    }).find((provider) => provider.id === "claude");
    expect(claude?.connected).toBe(false);
    expect(claude?.needsReconnect).toBeUndefined();
  });

  test("an imported Claude CLI login is connected but not ours to delete", () => {
    useTmpHome();
    const claude = jcodeAuthProviders({
      providers: [
        { id: "claude", status: "available", credential_source: "trusted external file" },
      ],
    }).find((provider) => provider.id === "claude");
    expect(claude?.connected).toBe(true);
    expect(claude?.fromEnv).toBe(true);
    expect(claude?.detail).toBe("Imported from another CLI");
  });

  test("an environment key is connected and not deletable", () => {
    useTmpHome();
    setEnv("OPENAI_API_KEY", "sk-test");
    const openai = jcodeAuthProviders(null).find((provider) => provider.id === "openai");
    expect(openai?.connected).toBe(true);
    expect(openai?.fromEnv).toBe(true);
  });

  test("disconnect removes only the jcode-managed file", () => {
    const home = useTmpHome();
    mkdirSync(join(home, ".jcode", "pending-login"), { recursive: true });
    writeFileSync(join(home, ".jcode", "auth.json"), JSON.stringify({ accessToken: "tok" }));
    writeFileSync(join(home, ".jcode", "pending-login", "claude.json"), "{}");
    deleteJcodeCredential("claude");
    expect(jcodeAuthProviders(null).find((provider) => provider.id === "claude")?.connected).toBe(
      false,
    );
  });
});

describe("summarizeJcodeAuthStatus", () => {
  test("keeps the existing available-without-account reading", () => {
    expect(
      summarizeJcodeAuthStatus({
        any_available: true,
        providers: [{ status: "available", credential_source: "none" }],
      }),
    ).toEqual({ available: true, accountConnected: false });
  });

  test("a stored credential is a connected account", () => {
    expect(
      summarizeJcodeAuthStatus({
        any_available: true,
        providers: [{ status: "available", credential_source: "stored" }],
      }),
    ).toEqual({ available: true, accountConnected: true });
  });
});
