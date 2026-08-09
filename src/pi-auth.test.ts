import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// pi's credential file location is env-driven, so each test gets its own.
let dir: string;
let prevAgentDir: string | undefined;
let prevAnthropicKey: string | undefined;
let prevOpencodeKey: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-auth-"));
  prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  prevAnthropicKey = process.env.ANTHROPIC_API_KEY;
  prevOpencodeKey = process.env.OPENCODE_API_KEY;
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENCODE_API_KEY;
});

afterEach(() => {
  if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
  if (prevAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevAnthropicKey;
  if (prevOpencodeKey === undefined) delete process.env.OPENCODE_API_KEY;
  else process.env.OPENCODE_API_KEY = prevOpencodeKey;
  rmSync(dir, { recursive: true, force: true });
});

async function piAuth() {
  return await import("./pi-auth.ts");
}

test("an empty auth.json is not proof of auth", async () => {
  const { hasPiProviderAuth, piAuthProviders, piAuthPath } = await piAuth();
  // pi writes `{}` the first time it starts, so this file exists on every box
  // pi has ever run on. Treating its existence as a credential is what made pi
  // report "Ready" while having nothing to authenticate with.
  mkdirSync(join(dir, "agent"), { recursive: true });
  writeFileSync(piAuthPath(), "{}");
  expect(hasPiProviderAuth()).toBe(false);
  expect(piAuthProviders().every((p) => !p.connected)).toBe(true);
});

test("a credential without a usable secret does not count as connected", async () => {
  const { hasPiProviderAuth, piAuthPath } = await piAuth();
  mkdirSync(join(dir, "agent"), { recursive: true });
  writeFileSync(
    piAuthPath(),
    JSON.stringify({ opencode: { type: "api_key" }, "openai-codex": { type: "oauth", refresh: "" } }),
  );
  expect(hasPiProviderAuth()).toBe(false);
});

test("storing an api key writes pi's own format at 0600", async () => {
  const { setPiProviderApiKey, piAuthPath, piAuthProviders, hasPiProviderAuth } = await piAuth();
  await setPiProviderApiKey("opencode", "  sk-zen-abc  ");
  const stored = JSON.parse(readFileSync(piAuthPath(), "utf8"));
  // Shape is pi's AuthStorage contract: a flat providerId -> Credential map.
  expect(stored).toEqual({ opencode: { type: "api_key", key: "sk-zen-abc" } });
  expect(statSync(piAuthPath()).mode & 0o777).toBe(0o600);
  expect(hasPiProviderAuth()).toBe(true);
  const opencode = piAuthProviders().find((p) => p.id === "opencode");
  expect(opencode?.connected).toBe(true);
  expect(opencode?.fromEnv).toBeUndefined();
});

test("writing one provider leaves the others untouched", async () => {
  const { setPiProviderApiKey, piAuthPath } = await piAuth();
  mkdirSync(join(dir, "agent"), { recursive: true });
  const existing = { "openai-codex": { type: "oauth", access: "a", refresh: "r", expires: 1 } };
  writeFileSync(piAuthPath(), JSON.stringify(existing));
  await setPiProviderApiKey("opencode", "sk-zen");
  const stored = JSON.parse(readFileSync(piAuthPath(), "utf8"));
  expect(stored["openai-codex"]).toEqual(existing["openai-codex"]);
  expect(stored.opencode).toEqual({ type: "api_key", key: "sk-zen" });
});

test("disconnecting removes only that provider", async () => {
  const { setPiProviderApiKey, deletePiCredential, piAuthPath, hasPiProviderAuth } = await piAuth();
  await setPiProviderApiKey("opencode", "sk-zen");
  await deletePiCredential("opencode");
  expect(JSON.parse(readFileSync(piAuthPath(), "utf8"))).toEqual({});
  expect(hasPiProviderAuth()).toBe(false);
});

test("an api key in the environment counts, but is flagged as not ours", async () => {
  const { piAuthProviders } = await piAuth();
  process.env.OPENCODE_API_KEY = "sk-from-env";
  const opencode = piAuthProviders().find((p) => p.id === "opencode");
  // pi resolves this env var itself, so the agent really is usable — but the
  // UI must not offer to disconnect a credential it does not own.
  expect(opencode?.connected).toBe(true);
  expect(opencode?.fromEnv).toBe(true);
});

test("ANTHROPIC_API_KEY alone still authenticates pi", async () => {
  const { hasPiProviderAuth } = await piAuth();
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  expect(hasPiProviderAuth()).toBe(true);
});

test("an api key is refused for a provider that signs in with a browser", async () => {
  const { setPiProviderApiKey } = await piAuth();
  expect(setPiProviderApiKey("openai-codex", "sk-nope")).rejects.toThrow(/browser/i);
});

test("an empty api key is refused", async () => {
  const { setPiProviderApiKey } = await piAuth();
  expect(setPiProviderApiKey("opencode", "   ")).rejects.toThrow(/API key/i);
});

test("a corrupt auth.json reads as no credentials rather than throwing", async () => {
  const { readPiCredentials, hasPiProviderAuth, piAuthPath } = await piAuth();
  mkdirSync(join(dir, "agent"), { recursive: true });
  writeFileSync(piAuthPath(), "{ not json");
  expect(readPiCredentials()).toEqual({});
  expect(hasPiProviderAuth()).toBe(false);
});

test("provider ids are validated before use", async () => {
  const { isPiAuthProviderId } = await piAuth();
  expect(isPiAuthProviderId("openai-codex")).toBe(true);
  expect(isPiAuthProviderId("opencode")).toBe(true);
  expect(isPiAuthProviderId("anthropic")).toBe(true);
  expect(isPiAuthProviderId("google")).toBe(false);
  expect(isPiAuthProviderId("../../etc/passwd")).toBe(false);
});

test("a provider key pinned in models.json counts as connected", async () => {
  const { piAuthProviders, hasPiProviderAuth } = await piAuth();
  // How pi was configured by hand before it had a sign-in. Ignoring it would
  // demote a working agent to "Needs setup" and drop it out of the composer.
  mkdirSync(join(dir, "agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent", "models.json"),
    JSON.stringify({ providers: { opencode: { apiKey: "$OPENCODE_API_KEY" } } }),
  );
  const opencode = piAuthProviders().find((p) => p.id === "opencode");
  expect(opencode?.connected).toBe(true);
  expect(opencode?.fromEnv).toBe(true);
  expect(hasPiProviderAuth()).toBe(true);
});

test("an empty models.json provider entry does not count", async () => {
  const { piAuthProviders } = await piAuth();
  mkdirSync(join(dir, "agent"), { recursive: true });
  writeFileSync(
    join(dir, "agent", "models.json"),
    JSON.stringify({ providers: { opencode: { baseUrl: "https://example.test" } } }),
  );
  expect(piAuthProviders().find((p) => p.id === "opencode")?.connected).toBe(false);
});

test("ANTHROPIC_API_KEY connects the anthropic provider specifically", async () => {
  const { piAuthProviders } = await piAuth();
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  const providers = piAuthProviders();
  expect(providers.find((p) => p.id === "anthropic")?.connected).toBe(true);
  // ...and only that one.
  expect(providers.find((p) => p.id === "openai-codex")?.connected).toBe(false);
});

test("a write takes pi's own lock and releases it", async () => {
  const { setPiProviderApiKey, piAuthPath } = await piAuth();
  await setPiProviderApiKey("opencode", "sk-zen");
  // proper-lockfile's protocol IS a directory at `<file>.lock`; leaving one
  // behind would block pi's own writes for the staleness window.
  expect(existsSync(`${piAuthPath()}.lock`)).toBe(false);
});

test("a held lock blocks a concurrent write instead of clobbering it", async () => {
  const { setPiProviderApiKey, piAuthPath, readPiCredentials } = await piAuth();
  await setPiProviderApiKey("opencode", "first");
  // Simulate pi holding the lock mid-refresh. Our write must wait rather than
  // read-modify-write over the top of a rotation in progress.
  mkdirSync(`${piAuthPath()}.lock`, { recursive: true });
  const started = Date.now();
  const write = setPiProviderApiKey("opencode", "second").catch(() => "blocked");
  await new Promise((r) => setTimeout(r, 250));
  expect(readPiCredentials().opencode.key).toBe("first");
  rmSync(`${piAuthPath()}.lock`, { recursive: true, force: true });
  await write;
  expect(readPiCredentials().opencode.key).toBe("second");
  expect(Date.now() - started).toBeGreaterThanOrEqual(200);
});
